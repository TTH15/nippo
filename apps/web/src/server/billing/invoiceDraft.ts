import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCounterpartyBillingSnapshot } from "./counterpartyBillingSnapshot";
import { computeDriverAutoPayout } from "./driverPayout";
import { loadDriverLease, loadCourseDailyLease, computeLeaseDeduction } from "./driverLease";

// 請求書の下書き（明細・採番・期間）を組み立てる共通ロジック。
// GET /api/admin/invoices/draft（編集画面が読む）と
// POST /api/admin/invoices/from-source（作成ボタンが叩く）の両方がここを使う。
// 以前は「ペイメント画面がクライアントで同じ集計を組み直す」実装が併存していて、
// 固定経費の有効期間フィルタ有無などで同じ月・同じドライバーでも中身がズレていた。

export type Section = "Amazon" | "ヤマト運輸" | "郵便局";

export type DraftLine = { title: string; qty: number; price: number; unit?: string };
export type DraftTableData = { main: DraftLine[]; deduct: DraftLine[] };

export type MonthRange = { month: string; startDate: string; endDate: string };

export type DriverDraft = {
  month: string;
  section: Section;
  issueDate: string;
  dueDate: string;
  invoiceNo: string;
  driver: {
    id: string;
    name: string;
    postalCode: string | null;
    address: string | null;
    phone: string | null;
    bankName: string | null;
    bankNo: string | null;
    bankHolder: string | null;
  };
  tableData: DraftTableData;
};

export type CounterpartyDraft = {
  month: string;
  section: Section;
  issueDate: string;
  dueDate: string;
  invoiceNo: string;
  counterparty: {
    id: string;
    name: string;
    postalCode: string | null;
    address: string | null;
    phone: string | null;
    /** 適格請求書発行事業者の登録番号 */
    invoiceRegNo: string | null;
  };
  tableData: DraftTableData;
};

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSection(value: unknown): Section {
  return value === "Amazon" || value === "ヤマト運輸" || value === "郵便局" ? value : "ヤマト運輸";
}

export function getMonthRange(monthParam: string | null | undefined): MonthRange {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    month: `${year}-${mm}`,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function nextMonthEndDate(month: string): string {
  const m = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const ny = mm === 12 ? y + 1 : y;
  const nm = mm === 12 ? 1 : mm + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → "YYYY年M月D日"（帳票 payload はこの表記で持つ）。 */
export function formatDateJa(iso: string): string {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso);
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** "YYYY-MM" → その月の1日〜末日の対象期間表示。 */
export function periodForMonth(month: string): string {
  const m = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(y, mo, 0).getDate();
  return `${y}年${mo}月1日〜${y}年${mo}月${lastDay}日`;
}

function normalizeCounterpartyToken(name: string | null | undefined) {
  const token = String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return token || null;
}

function buildInvoiceNo(params: {
  month: string;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
}) {
  const ym = params.month.replace("-", "");
  const byName = normalizeCounterpartyToken(params.counterpartyName);
  const byId = params.counterpartyId
    ? params.counterpartyId.replace(/-/g, "").slice(0, 4).toUpperCase()
    : null;
  const cp = byName || byId || "GEN";
  return `INV-${ym}-${cp}`;
}

/**
 * "{base}-R{NN}" 形式の次リビジョン番号を確定する（outgoing/incoming共用）。
 * invoice_no を降順で取得し最大リビジョンを確定する。
 * 旧実装は無順序 .limit(300) のため 300 件超でページング欠落→採番重複の恐れがあった。
 * ゼロ詰め2桁前提なので降順上位を見れば十分（書式ゆらぎに備え reduce で最大値を取る）。
 */
async function nextRevisionForBase(
  supabase: SupabaseClient,
  orgId: string,
  base: string,
): Promise<string> {
  const prefix = `${base}-R`;
  const { data, error } = await supabase
    .from("invoice_documents")
    .select("invoice_no")
    .eq("org_id", orgId)
    .like("invoice_no", `${prefix}%`)
    .order("invoice_no", { ascending: false })
    .limit(100);
  if (error) throw error;
  const maxRevision = (data ?? []).reduce((max: number, row: Record<string, unknown>) => {
    const no = String(row.invoice_no ?? "");
    const m = no.match(new RegExp(`^${prefix}(\\d{2})$`));
    if (!m) return max;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return max;
    return Math.max(max, n);
  }, -1);
  // R99 到達時はクランプすると重複するため、3桁へ桁上げして重複を避ける。
  const nextRevision = maxRevision + 1;
  return `${prefix}${String(nextRevision).padStart(2, "0")}`;
}

export async function buildNextInvoiceNo(
  supabase: SupabaseClient,
  orgId: string,
  params: {
    month: string;
    counterpartyId?: string | null;
    counterpartyName?: string | null;
  },
): Promise<string> {
  return nextRevisionForBase(supabase, orgId, buildInvoiceNo(params));
}

/** 受領請求書（ドライバー宛）の番号ベース："IN-{yyyymm}-{driverIdの先頭4桁16進を大文字化}"。 */
function buildIncomingInvoiceNo(driverId: string, month: string): string {
  const ym = month.replace("-", "");
  const token = driverId.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `IN-${ym}-${token}`;
}

export async function buildNextIncomingInvoiceNo(
  supabase: SupabaseClient,
  orgId: string,
  driverId: string,
  month: string,
): Promise<string> {
  return nextRevisionForBase(supabase, orgId, buildIncomingInvoiceNo(driverId, month));
}

/**
 * 受領請求書（ドライバー → 自社）の下書き。
 * コース単価×日報実績＋固定経費・臨時経費・リース控除を自動集計する。
 * 見つからないドライバーは null（呼び出し側で404にする）。
 */
export async function buildDriverDraft(
  supabase: SupabaseClient,
  orgId: string,
  driverId: string,
  range: MonthRange,
  section: Section,
): Promise<DriverDraft | null> {
  const { data: driver, error: driverErr } = await supabase
    .from("drivers")
    .select("id, name, postal_code, address, phone, bank_name, bank_no, bank_holder")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (driverErr) throw driverErr;
  if (!driver) return null;

  const autoPayout = await computeDriverAutoPayout(
    supabase,
    orgId,
    driverId,
    range.startDate,
    range.endDate,
  );
  const main: DraftLine[] = autoPayout.lines.map((l) => ({
    title: l.title,
    qty: l.qty,
    price: l.unitPrice,
    unit: l.unitId ? "個" : "日",
  }));
  const deduct: DraftLine[] = [];

  // 固定経費（driver_fixed_expenses・月額）→ お支払い分。
  // 有効期間（valid_from/valid_to）で当月分に絞る。ここを絞らないと
  // 終了済みの固定控除が請求書に載る（旧ペイメント画面の実装がそうだった）。
  const { data: fixedExpRows } = await supabase
    .from("driver_fixed_expenses")
    .select("name, amount")
    .eq("driver_id", driverId)
    .eq("cycle", "MONTHLY")
    .lte("valid_from", range.endDate)
    .or(`valid_to.is.null,valid_to.gte.${range.startDate}`);
  (fixedExpRows ?? []).forEach((r: { name: string; amount: number }) => {
    const amount = Number(r.amount) || 0;
    if (amount > 0) {
      deduct.push({ title: r.name || "固定控除", qty: 1, price: amount, unit: "" });
    } else if (amount < 0) {
      main.push({ title: `${r.name || "固定手当"}（手当）`, qty: 1, price: -amount, unit: "" });
    }
  });

  // 臨時経費（driver_ad_hoc_expenses・当月）: 正=控除（お支払い分）、負=手当（請求分へ加算）。
  const { data: adHocRows } = await supabase
    .from("driver_ad_hoc_expenses")
    .select("name, amount")
    .eq("driver_id", driverId)
    .eq("month", range.month);
  (adHocRows ?? []).forEach((r: { name: string; amount: number }) => {
    const amount = Number(r.amount) || 0;
    if (amount > 0) {
      deduct.push({ title: r.name || "当月控除", qty: 1, price: amount, unit: "" });
    } else if (amount < 0) {
      main.push({ title: `${r.name || "当月手当"}（手当）`, qty: 1, price: -amount, unit: "" });
    }
  });

  // リース控除（driver_leases・専用概念）。DAILYはコース日額(courses.daily_lease)由来。
  const [lease, courseDailyLease] = await Promise.all([
    loadDriverLease(supabase, driverId, range.startDate, range.endDate),
    loadCourseDailyLease(supabase, orgId),
  ]);
  const perDay = autoPayout.days.map((d) => ({ date: d.date, courseId: d.courseId }));
  const leaseDeduction = computeLeaseDeduction(lease, perDay, courseDailyLease);
  if (leaseDeduction > 0) {
    deduct.push({ title: "リース代", qty: 1, price: leaseDeduction, unit: "" });
  }

  if (main.length === 0) {
    main.push({ title: `${driver.name} ${range.month}分（明細なし）`, qty: 1, price: 0 });
  }

  return {
    month: range.month,
    section,
    issueDate: todayIsoDate(),
    dueDate: nextMonthEndDate(range.month),
    invoiceNo: await buildNextIncomingInvoiceNo(supabase, orgId, driverId, range.month),
    driver: {
      id: driver.id,
      name: driver.name,
      postalCode: driver.postal_code,
      address: driver.address,
      phone: driver.phone,
      bankName: driver.bank_name,
      bankNo: driver.bank_no,
      bankHolder: driver.bank_holder,
    },
    tableData: { main, deduct },
  };
}

/**
 * 売上請求書（自社 → 取引先）の下書き。
 * 取引先ごとの月次請求スナップショット（コース単価×シフト＋売上ログ）から明細を組む。
 * 見つからない取引先は null（呼び出し側で404にする）。
 */
export async function buildCounterpartyDraft(
  supabase: SupabaseClient,
  orgId: string,
  companyCode: string,
  counterpartyId: string,
  range: MonthRange,
  section: Section,
): Promise<CounterpartyDraft | null> {
  const { data: addr, error: addrErr } = await supabase
    .from("invoice_addresses")
    .select("id, name, postal_code, address, phone, invoice_no")
    .eq("id", counterpartyId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (addrErr) throw addrErr;
  if (!addr) return null;

  const snap = await buildCounterpartyBillingSnapshot(
    supabase,
    orgId,
    companyCode,
    counterpartyId,
    range.startDate,
    range.endDate,
    range.month,
  );

  const main: DraftLine[] = snap.mainLines.map((line) => ({
    title: line.label,
    qty: line.quantity,
    price: line.unitPrice,
  }));
  const deduct: DraftLine[] = snap.deductLines.map((line) => ({
    title: line.label,
    qty: line.quantity,
    price: line.unitPrice,
  }));

  if (main.length === 0) {
    main.push({ title: `${addr.name} ${range.month} 分（明細なし）`, qty: 1, price: 0 });
  }

  return {
    month: range.month,
    section,
    issueDate: todayIsoDate(),
    dueDate: nextMonthEndDate(range.month),
    invoiceNo: await buildNextInvoiceNo(supabase, orgId, {
      month: range.month,
      counterpartyId,
      counterpartyName: addr.name,
    }),
    counterparty: {
      id: addr.id,
      name: addr.name,
      postalCode: addr.postal_code ?? null,
      address: addr.address ?? null,
      phone: addr.phone ?? null,
      invoiceRegNo: addr.invoice_no ?? null,
    },
    tableData: { main, deduct },
  };
}

/** 明細から差引き合計（請求分 − お支払い分）を出す。税は含めない。 */
export function sumDraftTotal(tableData: DraftTableData): number {
  const sum = (lines: DraftLine[]) =>
    lines.reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0);
  return sum(tableData.main) - sum(tableData.deduct);
}
