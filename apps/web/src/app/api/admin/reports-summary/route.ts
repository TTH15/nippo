import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 集計テーブル（ドライバー×日付）の動的データ源。
//   新モデル(daily_reports_v2 + report_entries + units)から、
//   ドライバー×unit×日付 の「報告値」を返す。
//   従量unit: 課金数量フィールドの合計。固定unit: 稼働=1/日（個数に依らない）。
//   → 「宅/ネ」等のハードコードを廃し、設定した型がそのまま行になる。
// ============================================================

const BIG = 100000;

type UnitMeta = { id: string; name: string; billingType: string; sortOrder: number };

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const url = req.nextUrl;
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const driverId = url.searchParams.get("driver_id")?.trim() || "";
  if (!start || !end) return NextResponse.json({ units: [], byDriver: {} });

  // 対象日報（却下以外）
  let q = supabase
    .from("daily_reports_v2")
    .select("id, driver_id, report_date")
    .eq("org_id", orgId)
    .gte("report_date", start)
    .lte("report_date", end)
    .is("rejected_at", null)
    .limit(BIG);
  if (driverId) q = q.eq("driver_id", driverId);
  const { data: reports } = await q;
  const reportInfo = new Map<string, { driverId: string; date: string }>();
  (reports ?? []).forEach((r: any) => reportInfo.set(r.id, { driverId: r.driver_id, date: r.report_date }));
  const reportIds = Array.from(reportInfo.keys());
  if (reportIds.length === 0) return NextResponse.json({ units: [], byDriver: {} });

  // units / unit_fields
  const [{ data: unitRows }, { data: fieldRows }] = await Promise.all([
    supabase.from("units").select("id, name, billing_type, sort_order"),
    supabase.from("unit_fields").select("unit_id, field_key, is_billable"),
  ]);
  const unitMeta = new Map<string, UnitMeta>();
  (unitRows ?? []).forEach((u: any) => unitMeta.set(u.id, { id: u.id, name: u.name, billingType: u.billing_type, sortOrder: u.sort_order ?? 0 }));
  const billableByUnit = new Map<string, Set<string>>();
  (fieldRows ?? []).forEach((f: any) => {
    if (!f.is_billable) return;
    const s = billableByUnit.get(f.unit_id) ?? new Set<string>();
    s.add(f.field_key);
    billableByUnit.set(f.unit_id, s);
  });

  // report_entries（分割取得）
  type Entry = { report_id: string; unit_id: string; field_key: string; value_num: number | null };
  const entries: Entry[] = [];
  for (let i = 0; i < reportIds.length; i += 1000) {
    const slice = reportIds.slice(i, i + 1000);
    const { data } = await supabase
      .from("report_entries")
      .select("report_id, unit_id, field_key, value_num")
      .in("report_id", slice)
      .limit(BIG);
    (data ?? []).forEach((e: any) => entries.push(e));
  }

  // レポートごとに unit 単位で集計（従量=課金数量合計 / 固定=稼働1）
  // perReportUnit: `${reportId}:${unitId}` → billable sum
  const perReportUnitBillable = new Map<string, number>();
  const reportUnitSeen = new Set<string>();
  for (const e of entries) {
    const ruKey = `${e.report_id}:${e.unit_id}`;
    reportUnitSeen.add(ruKey);
    const billable = billableByUnit.get(e.unit_id);
    if (billable && billable.has(e.field_key)) {
      perReportUnitBillable.set(ruKey, (perReportUnitBillable.get(ruKey) ?? 0) + (Number(e.value_num) || 0));
    }
  }

  const appearing = new Set<string>();
  const byDriver: Record<string, Record<string, { total: number; byDate: Record<string, number> }>> = {};
  for (const ruKey of reportUnitSeen) {
    const [reportId, unitId] = ruKey.split(":");
    const info = reportInfo.get(reportId);
    const meta = unitMeta.get(unitId);
    if (!info || !meta) continue;
    const value = meta.billingType === "FIXED" ? 1 : (perReportUnitBillable.get(ruKey) ?? 0);
    appearing.add(unitId);
    byDriver[info.driverId] = byDriver[info.driverId] ?? {};
    const cell = byDriver[info.driverId][unitId] ?? { total: 0, byDate: {} };
    cell.byDate[info.date] = (cell.byDate[info.date] ?? 0) + value;
    cell.total += value;
    byDriver[info.driverId][unitId] = cell;
  }

  const units = Array.from(appearing)
    .map((id) => unitMeta.get(id)!)
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"))
    .map((m) => ({ id: m.id, name: m.name, billingType: m.billingType }));

  return NextResponse.json({ units, byDriver });
}
