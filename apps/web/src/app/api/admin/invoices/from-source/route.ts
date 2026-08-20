import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { getInvoiceIssuer } from "@/config/companies";
import {
  UUID_RE,
  buildCounterpartyDraft,
  buildDriverDraft,
  formatDateJa,
  getMonthRange,
  normalizeSection,
  periodForMonth,
  sumDraftTotal,
  type DraftTableData,
} from "@/server/billing/invoiceDraft";
import { bumpInvoiceNo, resolveUniqueInvoiceNo } from "@/server/billing/invoiceNumbering";
import { computeInvoiceTotals } from "@repo/core/logic/reward";

export const dynamic = "force-dynamic";

// 集計元を指定して請求書の下書きを1件作る、唯一の作成口。
// ペイメント画面・取引先画面・請求書一覧の作成ピッカーがすべてここを呼ぶ。
// （以前は3画面がそれぞれ別実装で作っていて、同じ月・同じ相手でも中身がズレていた）

type Body = {
  month?: string;
  section?: string;
  source?:
    | { type: "driver_payout"; driverId?: string }
    | { type: "counterparty"; counterpartyId?: string };
};

/** 〒付きの住所HTML。帳票の toAddr / fromAddr はこの形で持つ。 */
function addrHtml(postal: string | null, address: string | null): string {
  const p = String(postal ?? "").trim();
  const a = String(address ?? "").trim();
  if (!p && !a) return "";
  return p ? `〒${p}<br/>${a}` : a;
}

/** 下書き明細 → 帳票 payload の tableData（単価は税抜入力を既定とする）。 */
function toPayloadLines(tableData: DraftTableData) {
  const map = (lines: DraftTableData["main"]) =>
    lines.map((l) => ({
      title: l.title,
      qty: l.qty,
      unit: l.unit ?? "",
      price: l.price,
      priceBasis: l.priceBasis === "inclusive" ? "inclusive" as const : "exclusive" as const,
    }));
  return { main: map(tableData.main), deduct: map(tableData.deduct) };
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const range = getMonthRange(body.month ?? null);
  const section = normalizeSection(body.section);
  const source = body.source;
  const issuer = getInvoiceIssuer(user.companyCode);

  let insertRow: Record<string, unknown>;

  if (source?.type === "driver_payout") {
    const driverId = String(source.driverId ?? "");
    if (!UUID_RE.test(driverId)) {
      return NextResponse.json({ error: "driverId が不正です" }, { status: 400 });
    }
    let draft;
    try {
      draft = await buildDriverDraft(supabase, orgId, driverId, range, section);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!draft) {
      return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
    }
    const d = draft.driver;
    insertRow = {
      org_id: orgId,
      company_code: user.companyCode,
      month_yyyy_mm: draft.month,
      section: draft.section,
      // 受領請求書はドライバー起点なので driver_id が必須（本人の報酬画面もこれで引く）
      driver_id: d.id,
      counterparty_invoice_address_id: null,
      client_name: d.name,
      issue_date: draft.issueDate,
      invoice_no: draft.invoiceNo,
      amount: sumDraftTotal(draft.tableData),
      status: "draft",
      is_starred: false,
      payload: {
        source: "system_invoice",
        // 請求先＝自社
        toName: issuer.name,
        toAddr: issuer.addressHtml,
        toTel: issuer.tel,
        toReg: issuer.regNo,
        honorific: "御中",
        // 請求元＝ドライバー
        fromName: d.name,
        fromAddr: addrHtml(d.postalCode, d.address),
        fromTel: d.phone ?? "",
        fromReg: "",
        period: periodForMonth(draft.month),
        invoiceNo: draft.invoiceNo,
        issueDate: formatDateJa(draft.issueDate),
        dueDate: draft.dueDate,
        // 振込先＝ドライバー口座
        bankName: d.bankName ?? "",
        bankNo: d.bankNo ?? "",
        bankHolder: d.bankHolder ?? "",
        notes: "",
        tableData: toPayloadLines(draft.tableData),
        // ドライバーは免税事業者前提（登録番号を持たない）。従来のペイメント画面と同じ。
        taxSettings: { enabled: false, rate: 10 },
        displayBasis: "exclusive",
        parties: { fromParty: `drv-${d.id}`, toParty: "ace_creation" },
      },
    };
  } else if (source?.type === "counterparty") {
    const counterpartyId = String(source.counterpartyId ?? "");
    if (!UUID_RE.test(counterpartyId)) {
      return NextResponse.json({ error: "counterpartyId が不正です" }, { status: 400 });
    }
    let draft;
    try {
      draft = await buildCounterpartyDraft(
        supabase,
        orgId,
        user.companyCode,
        counterpartyId,
        range,
        section,
      );
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!draft) {
      return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
    }
    const c = draft.counterparty;
    const payloadTableData = toPayloadLines(draft.tableData);
    const initialTotals = computeInvoiceTotals({
      main: payloadTableData.main,
      deduct: payloadTableData.deduct,
      loanRepay: 0,
      extraOutsourcing: 0,
      taxEnabled: true,
      taxRatePercent: 10,
      displayBasis: draft.displayBasis,
    });
    insertRow = {
      org_id: orgId,
      company_code: user.companyCode,
      month_yyyy_mm: draft.month,
      section: draft.section,
      driver_id: null,
      counterparty_invoice_address_id: c.id,
      client_name: c.name,
      issue_date: draft.issueDate,
      invoice_no: draft.invoiceNo,
      amount: initialTotals.total,
      status: "draft",
      is_starred: false,
      payload: {
        source: "system_invoice",
        // 請求先＝取引先
        toName: c.name,
        toAddr: addrHtml(c.postalCode, c.address),
        toTel: c.phone ?? "",
        toReg: c.invoiceRegNo ?? "",
        honorific: "御中",
        // 請求元＝自社
        fromName: issuer.name,
        fromAddr: issuer.addressHtml,
        fromTel: issuer.tel,
        fromReg: issuer.regNo,
        period: periodForMonth(draft.month),
        invoiceNo: draft.invoiceNo,
        issueDate: formatDateJa(draft.issueDate),
        dueDate: draft.dueDate,
        // 振込先＝自社口座
        bankName: issuer.bankName,
        bankNo: issuer.bankNo,
        bankHolder: issuer.bankHolder,
        notes: "",
        tableData: payloadTableData,
        taxSettings: { enabled: true, rate: 10 },
        displayBasis: draft.displayBasis,
        parties: { fromParty: "ace_creation", toParty: `corp-${c.id}` },
      },
    };
  } else {
    return NextResponse.json({ error: "source.type が不正です" }, { status: 400 });
  }

  try {
    insertRow.invoice_no = await resolveUniqueInvoiceNo(
      supabase,
      orgId,
      typeof insertRow.invoice_no === "string" ? insertRow.invoice_no : null,
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // unique 制約に当たったら番号を進めて再試行（同時作成の競合対策）
  let data: { id: string } | null = null;
  let error: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await supabase
      .from("invoice_documents") // tenant-scope-ok: insertRow に org_id: orgId を含む
      .insert(insertRow)
      .select("id")
      .single();
    data = res.data;
    error = res.error;
    if (!error) break;
    if (error.code !== "23505") break;
    insertRow.invoice_no = await resolveUniqueInvoiceNo(
      supabase,
      orgId,
      typeof insertRow.invoice_no === "string"
        ? bumpInvoiceNo(insertRow.invoice_no)
        : "INV-MANUAL-R01",
    );
  }

  if (error || !data) {
    console.error(error);
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "請求書の採番に失敗しました。再実行してください。" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error?.message ?? "DB error" }, { status: 500 });
  }

  return NextResponse.json({ invoice: { id: data.id } });
}
