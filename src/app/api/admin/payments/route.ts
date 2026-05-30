import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { buildContext, buildContributions, sumBy } from "@/server/aggregation/compute";

export const dynamic = "force-dynamic";

function getMonthRange(monthParam: string | null): { month: string; startDate: string; endDate: string } {
  let year: number;
  let month: number;
  const now = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { month: `${year}-${mm}`, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

export type DriverPaymentRow = {
  driverId: string;
  driverName: string;
  displayName: string | null;
  incomeLog: number;
  yamatoIncome: number;
  amazonIncome: number;
  otherIncome: number;
  fixedDeductions: number;
  adHocDeductions: number;
  net: number;
};

// ============================================================
// ドライバー別ペイメント（月次）。新モデル（集計エンジン）で算出。
//   incomeLog  = 自動算出のドライバー支払（従量+固定）
//   yamato/amazon/otherIncome = 自動算出のキャリア別支払
//   adHocDeductions = -(台帳 payout_delta)  ※手当はマイナス控除＝加算
//   fixedDeductions = driver_fixed_expenses（毎月の固定控除・従来どおり）
//   net = incomeLog - fixedDeductions - adHocDeductions
// ============================================================
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const monthParam = req.nextUrl.searchParams.get("month");
  const { month, startDate, endDate } = getMonthRange(monthParam);

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id, name, display_name")
    .eq("company_code", user.companyCode)
    .eq("role", "DRIVER")
    .order("name");

  if (driversError || !drivers?.length) {
    return NextResponse.json({ month, startDate, endDate, rows: [] as DriverPaymentRow[] });
  }
  const driverIds = drivers.map((d: { id: string }) => d.id);

  // 自動算出は新モデル(v2)。手動調整(臨時手当/控除)は既存 driver_ad_hoc_expenses を直読み（ハイブリッド）
  const data = await loadAggregationData(supabase, startDate, endDate);
  const codeByCarrier = new Map(data.carriers.map((c) => [c.id, c.code]));
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates);
  const auto = buildContributions(data.reports, [], ctx);

  const autoPayoutByDriver = sumBy(auto, (c) => c.driverId);

  // キャリア別の自動支払
  const incomeByDriverCarrier = new Map<string, { yamato: number; amazon: number; other: number }>();
  for (const c of auto) {
    if (!c.driverId) continue;
    const cur = incomeByDriverCarrier.get(c.driverId) ?? { yamato: 0, amazon: 0, other: 0 };
    const code = codeByCarrier.get(c.carrierId ?? "");
    if (code === "AMAZON") cur.amazon += c.payout;
    else if (code === "YAMATO") cur.yamato += c.payout;
    else cur.other += c.payout;
    incomeByDriverCarrier.set(c.driverId, cur);
  }

  // 固定控除（毎月）
  const { data: fixedRows } = await supabase
    .from("driver_fixed_expenses")
    .select("driver_id, amount")
    .in("driver_id", driverIds)
    .eq("cycle", "MONTHLY")
    .lte("valid_from", endDate)
    .or(`valid_to.is.null,valid_to.gte.${startDate}`);
  const fixedByDriver: Record<string, number> = {};
  driverIds.forEach((id: string) => (fixedByDriver[id] = 0));
  (fixedRows ?? []).forEach((row: { driver_id: string; amount: number }) => {
    if (fixedByDriver[row.driver_id] !== undefined) fixedByDriver[row.driver_id] += Number(row.amount) || 0;
  });

  // 臨時手当/控除（月次・既存テーブル）。amount 正=控除（net から減算）。
  const { data: adHocRows } = await supabase
    .from("driver_ad_hoc_expenses")
    .select("driver_id, amount")
    .in("driver_id", driverIds)
    .eq("month", month);
  const adHocByDriver: Record<string, number> = {};
  driverIds.forEach((id: string) => (adHocByDriver[id] = 0));
  (adHocRows ?? []).forEach((row: { driver_id: string; amount: number }) => {
    if (adHocByDriver[row.driver_id] !== undefined) adHocByDriver[row.driver_id] += Number(row.amount) || 0;
  });

  const rows: DriverPaymentRow[] = drivers.map((d: { id: string; name: string; display_name: string | null }) => {
    const incomeLog = autoPayoutByDriver.get(d.id)?.payout ?? 0;
    const carrier = incomeByDriverCarrier.get(d.id) ?? { yamato: 0, amazon: 0, other: 0 };
    const fixedDeductions = fixedByDriver[d.id] ?? 0;
    const adHocDeductions = adHocByDriver[d.id] ?? 0;
    const net = incomeLog - fixedDeductions - adHocDeductions;
    return {
      driverId: d.id,
      driverName: d.name,
      displayName: d.display_name ?? null,
      incomeLog,
      yamatoIncome: carrier.yamato,
      amazonIncome: carrier.amazon,
      otherIncome: carrier.other,
      fixedDeductions,
      adHocDeductions,
      net,
    };
  });

  return NextResponse.json({ month, startDate, endDate, rows });
}
