import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";

export const dynamic = "force-dynamic";

// ============================================================
// 集計テーブル（ドライバー×日付）の動的データ源。
//   新モデル(daily_reports_v2 + report_entries + units)から、
//   ドライバー×unit×日付 の「報告値」を返す。
//   従量unit: 課金数量フィールドの合計。固定unit: 稼働=1/日（個数に依らない）。
//   → 「宅/ネ」等のハードコードを廃し、設定した型がそのまま行になる。
//
// ★unit の合計（total）だけでなく、報告項目ごとの個数（fields）も返す。
//   合計には課金対象（is_billable）しか入らないため、そのままだと
//   **持戻個数や Amazon の午前/午後/4便の個数がどの画面からも参照できない**
//   （FIXED unit は稼働1日に潰れる）。画面側の「内訳」表示がここを読む。
// ============================================================

type UnitMeta = {
  id: string;
  name: string;
  billingType: string;
  sortOrder: number;
  /** キャリア（ヤマト運輸 / Amazon …）。unit 名は会社をまたぐと重複しうるので必ず添える。 */
  carrierId: string | null;
  carrierName: string;
  carrierSortOrder: number;
};

/** 個数として集計できる報告項目（数値入力のものだけ）。 */
type FieldMeta = {
  unitId: string;
  key: string;
  label: string;
  groupLabel: string | null;
  isBillable: boolean;
  sortOrder: number;
};

/** 個数の入れ物（期間合計＋日別）。 */
type Counts = { total: number; byDate: Record<string, number> };

function addCount(target: Record<string, Counts>, key: string, date: string, value: number): void {
  const cell = target[key] ?? { total: 0, byDate: {} };
  cell.byDate[date] = (cell.byDate[date] ?? 0) + value;
  cell.total += value;
  target[key] = cell;
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const url = req.nextUrl;
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const driverId = url.searchParams.get("driver_id")?.trim() || "";
  // 項目ごとの個数は日別まで持つとレスポンスが数倍になるため、要求された時だけ返す
  // detail=1（配達実績ページ）は項目・日別・コース別まで一式返す
  const detail = url.searchParams.get("detail") === "1";
  const withFields = detail || url.searchParams.get("fields") === "1";
  if (!start || !end) return NextResponse.json({ units: [], byDriver: {} });

  // 対象日報（却下以外）
  const reports = await fetchAllRows((from, to) => {
    let q = supabase
      .from("daily_reports_v2")
      .select("id, driver_id, report_date, course_id")
      .eq("org_id", orgId)
      .gte("report_date", start)
      .lte("report_date", end)
      .is("rejected_at", null);
    if (driverId) q = q.eq("driver_id", driverId);
    // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
    return q.order("report_date", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });
  const reportInfo = new Map<string, { driverId: string; date: string; courseId: string | null }>();
  (reports ?? []).forEach((r: any) =>
    reportInfo.set(r.id, { driverId: r.driver_id, date: r.report_date, courseId: r.course_id ?? null }),
  );
  const reportIds = Array.from(reportInfo.keys());
  if (reportIds.length === 0) return NextResponse.json({ units: [], byDriver: {} });

  // units / unit_fields / carriers
  const [{ data: unitRows }, { data: fieldRows }, { data: carrierRows }] = await Promise.all([
    supabase.from("units").select("id, name, billing_type, sort_order, carrier_id"),
    supabase
      .from("unit_fields")
      .select("unit_id, field_key, label, group_label, input_type, is_billable, sort_order"),
    supabase.from("carriers").select("id, name, sort_order"),
  ]);

  const carrierById = new Map<string, { name: string; sortOrder: number }>();
  (carrierRows ?? []).forEach((c: any) =>
    carrierById.set(c.id, { name: c.name, sortOrder: c.sort_order ?? 0 }),
  );

  const unitMeta = new Map<string, UnitMeta>();
  (unitRows ?? []).forEach((u: any) => {
    const carrier = u.carrier_id ? carrierById.get(u.carrier_id) : undefined;
    unitMeta.set(u.id, {
      id: u.id,
      name: u.name,
      billingType: u.billing_type,
      sortOrder: u.sort_order ?? 0,
      carrierId: u.carrier_id ?? null,
      carrierName: carrier?.name ?? "その他",
      carrierSortOrder: carrier?.sortOrder ?? 9999,
    });
  });

  const billableByUnit = new Map<string, Set<string>>();
  const fieldMeta = new Map<string, FieldMeta>();
  (fieldRows ?? []).forEach((f: any) => {
    if (f.is_billable) {
      const s = billableByUnit.get(f.unit_id) ?? new Set<string>();
      s.add(f.field_key);
      billableByUnit.set(f.unit_id, s);
    }
    // 個数として数えられるのは数値入力の項目だけ（時刻・自由記述は対象外）
    if (f.input_type !== "INT") return;
    fieldMeta.set(`${f.unit_id}:${f.field_key}`, {
      unitId: f.unit_id,
      key: f.field_key,
      label: f.label,
      groupLabel: f.group_label ?? null,
      isBillable: Boolean(f.is_billable),
      sortOrder: f.sort_order ?? 0,
    });
  });

  // report_entries（分割取得）。200件ずつのバッチを直列に待つと往復が積み上がるため並列で流す
  type Entry = { report_id: string; unit_id: string; field_key: string; value_num: number | null };
  const entrySlices: string[][] = [];
  for (let i = 0; i < reportIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    entrySlices.push(reportIds.slice(i, i + IN_CLAUSE_BATCH_SIZE));
  }
  const entryPages = await Promise.all(
    entrySlices.map((slice) =>
      fetchAllRows((from, to) =>
        supabase
          .from("report_entries")
          .select("report_id, unit_id, field_key, value_num")
          .in("report_id", slice)
          // ページングには一意な並びが必須（無いと行の重複・欠落が起きる）
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ),
  );
  const entries: Entry[] = entryPages.flat() as Entry[];

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
  const appearingFields = new Set<string>();
  const byDriver: Record<
    string,
    Record<string, Counts & { fields: Record<string, Counts> }>
  > = {};

  const cellOf = (driverId: string, unitId: string) => {
    byDriver[driverId] = byDriver[driverId] ?? {};
    const cell = byDriver[driverId][unitId] ?? { total: 0, byDate: {}, fields: {} };
    byDriver[driverId][unitId] = cell;
    return cell;
  };

  for (const ruKey of reportUnitSeen) {
    const [reportId, unitId] = ruKey.split(":");
    const info = reportInfo.get(reportId);
    const meta = unitMeta.get(unitId);
    if (!info || !meta) continue;
    const value = meta.billingType === "FIXED" ? 1 : (perReportUnitBillable.get(ruKey) ?? 0);
    appearing.add(unitId);
    const cell = cellOf(info.driverId, unitId);
    cell.byDate[info.date] = (cell.byDate[info.date] ?? 0) + value;
    cell.total += value;
  }

  // 日別・コース別（detail=1 のときだけ。配達実績ページのグラフと内訳が使う）
  // ここは項目ごとの実数を持つ。unit 合計と違い FIXED を 1 に潰さない
  const byDate: Record<string, Record<string, Record<string, number>>> = {};
  const byCourse: Record<string, Record<string, Record<string, number>>> = {};
  const addNested = (
    target: Record<string, Record<string, Record<string, number>>>,
    outer: string,
    unitId: string,
    fieldKey: string,
    value: number,
  ) => {
    target[outer] = target[outer] ?? {};
    target[outer][unitId] = target[outer][unitId] ?? {};
    target[outer][unitId][fieldKey] = (target[outer][unitId][fieldKey] ?? 0) + value;
  };

  // 報告項目ごとの個数（持戻・時間帯別など、合計には現れない値）
  if (withFields) {
    for (const e of entries) {
      const info = reportInfo.get(e.report_id);
      const field = fieldMeta.get(`${e.unit_id}:${e.field_key}`);
      if (!info || !field || !unitMeta.has(e.unit_id)) continue;
      const value = Number(e.value_num) || 0;
      appearingFields.add(`${e.unit_id}:${e.field_key}`);
      addCount(cellOf(info.driverId, e.unit_id).fields, e.field_key, info.date, value);

      if (detail) {
        addNested(byDate, info.date, e.unit_id, e.field_key, value);
        if (info.courseId) addNested(byCourse, info.courseId, e.unit_id, e.field_key, value);
      }
    }
  }

  const units = Array.from(appearing)
    .map((id) => unitMeta.get(id)!)
    .filter(Boolean)
    // キャリアごとにまとめてから unit 順（同名 unit が別キャリアに並んでも読み違えない）
    .sort(
      (a, b) =>
        a.carrierSortOrder - b.carrierSortOrder ||
        a.carrierName.localeCompare(b.carrierName, "ja") ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, "ja"),
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      billingType: m.billingType,
      carrierId: m.carrierId,
      carrierName: m.carrierName,
      // 期間内に報告のあった項目だけ（定義したが誰も入力していない項目は列を作らない）
      fields: Array.from(fieldMeta.values())
        .filter((f) => f.unitId === m.id && appearingFields.has(`${f.unitId}:${f.key}`))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
        .map((f) => ({
          key: f.key,
          label: f.label,
          groupLabel: f.groupLabel,
          isBillable: f.isBillable,
        })),
    }));

  if (!detail) return NextResponse.json({ units, byDriver });

  // 配達実績ページ用の付帯データ（名前解決）。
  // IN 句は件数が多いと PostgREST のヘッダ上限で失敗するのでバッチに割る
  const fetchNames = async (
    table: "courses" | "drivers",
    ids: string[],
    columns: string,
  ): Promise<any[]> => {
    const rows: any[] = [];
    for (let i = 0; i < ids.length; i += IN_CLAUSE_BATCH_SIZE) {
      const { data } = await supabase
        .from(table)
        .select(columns)
        .eq("org_id", orgId)
        .in("id", ids.slice(i, i + IN_CLAUSE_BATCH_SIZE));
      rows.push(...(data ?? []));
    }
    return rows;
  };

  const [courseRows, driverRows] = await Promise.all([
    fetchNames("courses", Object.keys(byCourse), "id, name, summary_title"),
    fetchNames("drivers", Object.keys(byDriver), "id, name, display_name"),
  ]);

  // 稼働日数は「日報を出した日」で数える（シフトではなく実績ベース）
  const workDaysByDriver: Record<string, number> = {};
  const seenDriverDate = new Set<string>();
  for (const info of reportInfo.values()) {
    const key = `${info.driverId} ${info.date}`;
    if (seenDriverDate.has(key)) continue;
    seenDriverDate.add(key);
    workDaysByDriver[info.driverId] = (workDaysByDriver[info.driverId] ?? 0) + 1;
  }

  return NextResponse.json({
    units,
    byDriver,
    byDate,
    byCourse,
    workDaysByDriver,
    courses: courseRows.map((c: any) => ({
      id: c.id,
      name: (c.summary_title as string | null)?.trim() || c.name,
    })),
    drivers: driverRows.map((d: any) => ({
      id: d.id,
      name: (d.display_name as string | null)?.trim() || d.name,
    })),
  });
}
