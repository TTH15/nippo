import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { sumRowsRounded } from "@repo/core/logic/reward";

export const dynamic = "force-dynamic";

// ============================================================
// 請求書の「税込（取引先送付用）」⇔「税抜（税務提出用）」ペアを生成する。
// 既存の1件（変換元）はそのまま据え置き、変換先を新規レコードとして複製保存する
// （2種類を別々に保管・編集できるようにするため。参照はpayload.pairInvoiceIdで持つ）。
// ============================================================

type Line = { title: string; qty: number; unit: string; price: number };
type Variant = "client_inclusive" | "tax_exclusive";

function convertLines(lines: Line[], target: Variant): Line[] {
  return lines.map((l) => ({
    ...l,
    price: target === "tax_exclusive" ? Math.floor(l.price / 1.1) : Math.round(l.price * 1.1),
  }));
}

/** ペア相手の現在の金額・行数量を返す（検算パネル用）。ペアが無ければ paired: null。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_view_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { data: source, error: srcErr } = await supabase
    .from("invoice_documents")
    .select("id, payload")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (srcErr) return NextResponse.json({ error: "DB error" }, { status: 500 });
  if (!source) return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });

  const pairId = (source.payload as Record<string, unknown> | null)?.pairInvoiceId as string | undefined;
  if (!pairId) return NextResponse.json({ paired: null });

  const { data: paired } = await supabase
    .from("invoice_documents")
    .select("id, invoice_no, amount, payload")
    .eq("id", pairId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!paired) return NextResponse.json({ paired: null });

  const tableData = (paired.payload as Record<string, unknown> | null)?.tableData as
    | { main?: Line[]; deduct?: Line[] }
    | undefined;
  const variant = (paired.payload as Record<string, unknown> | null)?.taxVariant as Variant | undefined;
  return NextResponse.json({
    paired: {
      id: paired.id,
      invoiceNo: paired.invoice_no,
      amount: paired.amount,
      variant: variant ?? null,
      mainQtyTotal: (tableData?.main ?? []).reduce((a, l) => a + (Number(l.qty) || 0), 0),
      deductQtyTotal: (tableData?.deduct ?? []).reduce((a, l) => a + (Number(l.qty) || 0), 0),
      lineCount: (tableData?.main ?? []).length + (tableData?.deduct ?? []).length,
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { data: source, error: srcErr } = await supabase
    .from("invoice_documents")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (srcErr) {
    console.error(srcErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!source) return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });

  const payload = (source.payload ?? {}) as Record<string, unknown>;
  if (payload.pairInvoiceId) {
    return NextResponse.json(
      { error: "既にペアが存在します", pairedInvoiceId: payload.pairInvoiceId },
      { status: 409 },
    );
  }

  const sourceVariant: Variant = payload.taxVariant === "tax_exclusive" ? "tax_exclusive" : "client_inclusive";
  const targetVariant: Variant = sourceVariant === "tax_exclusive" ? "client_inclusive" : "tax_exclusive";

  const tableData = (payload.tableData ?? {}) as { main?: Line[]; deduct?: Line[] };
  const main = convertLines(tableData.main ?? [], targetVariant);
  const deduct = convertLines(tableData.deduct ?? [], targetVariant);

  const taxSettings = (payload.taxSettings ?? { enabled: true, rate: 10 }) as { enabled?: boolean; rate?: number };
  const rate = taxSettings.enabled ? (Number(taxSettings.rate) || 0) / 100 : 0;
  const billSubtotal = sumRowsRounded(main);
  const deductSubtotal = sumRowsRounded(deduct);
  const billGross = billSubtotal + Math.floor(billSubtotal * rate);
  const deductGross = deductSubtotal + Math.floor(deductSubtotal * rate);
  const loanRepay = Number(payload.loanRepay) || 0;
  const currentTotal = billGross - deductGross - loanRepay;
  const targetAmount = Number(source.amount) || 0;
  const extraOutsourcing = targetAmount - currentTotal > 0 ? targetAmount - currentTotal : 0;
  const newAmount = currentTotal + extraOutsourcing;

  const suffix = targetVariant === "tax_exclusive" ? "TAX" : "CLIENT";
  let invoiceNo = `${String(source.invoice_no ?? "").trim() || "INV-MANUAL"}-${suffix}`;
  for (let i = 0; i < 20; i++) {
    const { data: dup } = await supabase
      .from("invoice_documents")
      .select("id")
      .eq("org_id", orgId)
      .eq("invoice_no", invoiceNo)
      .limit(1);
    if (!dup?.length) break;
    invoiceNo = `${String(source.invoice_no ?? "").trim() || "INV-MANUAL"}-${suffix}${i + 2}`;
  }

  const newPayload = {
    ...payload,
    invoiceNo,
    tableData: { main, deduct },
    extraOutsourcing,
    taxVariant: targetVariant,
    pairInvoiceId: source.id,
    notes: typeof payload.notes === "string" && payload.notes ? payload.notes : "",
  };

  const { data: inserted, error: insErr } = await supabase
    .from("invoice_documents")
    .insert({
      org_id: orgId,
      company_code: source.company_code,
      month_yyyy_mm: source.month_yyyy_mm,
      section: source.section,
      driver_id: source.driver_id,
      counterparty_invoice_address_id: source.counterparty_invoice_address_id,
      client_name: source.client_name,
      issue_date: source.issue_date,
      invoice_no: invoiceNo,
      amount: newAmount,
      status: "draft",
      is_starred: source.is_starred,
      payload: newPayload,
    })
    .select("id, invoice_no, amount")
    .single();
  if (insErr) {
    console.error(insErr);
    return NextResponse.json({ error: "ペアの作成に失敗しました" }, { status: 500 });
  }

  const { error: updErr } = await supabase
    .from("invoice_documents")
    .update({ payload: { ...payload, taxVariant: sourceVariant, pairInvoiceId: inserted.id } })
    .eq("id", source.id);
  if (updErr) {
    console.error(updErr);
    return NextResponse.json({ error: "元の請求書の更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({
    pairedInvoiceId: inserted.id,
    pairedInvoiceNo: inserted.invoice_no,
    pairedAmount: inserted.amount,
    pairedVariant: targetVariant,
  });
}
