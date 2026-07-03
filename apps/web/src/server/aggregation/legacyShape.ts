import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./pagination";

// ============================================================
// Phase9 移行ヘルパ: daily_reports_v2 + report_entries から
// 旧 daily_reports と同じ「平坦行」を再構成して返す互換リーダー。
//   legacySync.ts(old→v2) の逆マップ。旧テーブルを読まずに既存の読み手を
//   v2 ソースへ差し替えるための橋渡し（読み手の下流ロジックは不変）。
// 旧が source of truth の間は v2=mirror のため値が一致する(parity検証)。
// ============================================================

export type VehiclePlatePayload = {
  id: string;
  number_prefix: string | null;
  number_class: string | null;
  number_hiragana: string | null;
  number_numeric: string | null;
  manufacturer: string | null;
  brand: string | null;
};

/** 旧 daily_reports 1行と同じ形（読み手が参照するカラムを網羅） */
export type LegacyDailyRow = {
  /** idSource により 旧 daily_reports.id(legacy) もしくは v2.id */
  id: string;
  /** 車両 FK 埋め込み（withVehicle 時のみ）。day-summary 等の vehicles 参照互換 */
  vehicles?: VehiclePlatePayload | null;
  driver_id: string;
  driver_identity_id: string | null;
  report_date: string;
  course_id: string | null;
  course_name: string | null; // コースの実表示名（同一キャリアで複数コースのとき行を見分けるため）
  carrier: string; // 'YAMATO' | 'AMAZON'（旧コード。新キャリアでcode未設定だと 'YAMATO' に既定化される点に注意）
  carrier_id: string | null;
  carrier_name: string | null; // キャリアの実表示名（動的キャリア対応の表示用）
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  amazon_am_mochidashi: number;
  amazon_am_completed: number;
  amazon_pm_mochidashi: number;
  amazon_pm_completed: number;
  amazon_4_mochidashi: number;
  amazon_4_completed: number;
  vehicle_id: string | null;
  meter_value: number | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
};

type Filters = {
  start?: string;
  end?: string;
  driverId?: string;
  driverIdentityId?: string;
  vehicleId?: string;
};

type Options = {
  /** id を v2 行のid にする（編集/承認を v2 へ向ける場合）。既定は legacy（旧id互換） */
  idSource?: "legacy" | "v2";
  /** vehicles プレート埋め込みを付与（day-summary 等） */
  withVehicle?: boolean;
};

/** report_entries の (unit code, field_key) → 旧カラム名 */
const COLUMN_BY_UNIT_FIELD: Record<string, keyof LegacyDailyRow> = {
  "TAKUHAIBIN:completed": "takuhaibin_completed",
  "TAKUHAIBIN:returned": "takuhaibin_returned",
  "NEKOPOS:completed": "nekopos_completed",
  "NEKOPOS:returned": "nekopos_returned",
  "AMAZON_DELIVERY:am_mochidashi": "amazon_am_mochidashi",
  "AMAZON_DELIVERY:am_completed": "amazon_am_completed",
  "AMAZON_DELIVERY:pm_mochidashi": "amazon_pm_mochidashi",
  "AMAZON_DELIVERY:pm_completed": "amazon_pm_completed",
  "AMAZON_DELIVERY:four_mochidashi": "amazon_4_mochidashi",
  "AMAZON_DELIVERY:four_completed": "amazon_4_completed",
};

function zeroCounts() {
  return {
    takuhaibin_completed: 0,
    takuhaibin_returned: 0,
    nekopos_completed: 0,
    nekopos_returned: 0,
    amazon_am_mochidashi: 0,
    amazon_am_completed: 0,
    amazon_pm_mochidashi: 0,
    amazon_pm_completed: 0,
    amazon_4_mochidashi: 0,
    amazon_4_completed: 0,
  };
}

/**
 * v2 から旧 daily_reports 互換の行を取得する。
 * 旧の読み手の `.from("daily_reports").select(...)` 差し替え用。
 */
export async function loadLegacyDailyRows(
  supabase: SupabaseClient,
  filters: Filters,
  options: Options = {},
): Promise<LegacyDailyRow[]> {
  const buildQuery = (from: number, to: number) => {
    let q = supabase
      .from("daily_reports_v2")
      .select(
        "id, legacy_report_id, driver_id, identity_id, report_date, course_id, carrier_id, vehicle_id, meter_value, submitted_at, approved_at, approved_by, rejected_at, rejected_by",
      );
    if (filters.start) q = q.gte("report_date", filters.start);
    if (filters.end) q = q.lte("report_date", filters.end);
    if (filters.driverId) q = q.eq("driver_id", filters.driverId);
    if (filters.driverIdentityId) q = q.eq("identity_id", filters.driverIdentityId);
    if (filters.vehicleId) q = q.eq("vehicle_id", filters.vehicleId);
    return q.range(from, to);
  };

  const [reportRows, { data: carrierRows }, { data: unitRows }, { data: courseRows }] = await Promise.all([
    fetchAllRows(buildQuery),
    supabase.from("carriers").select("id, code, name"),
    supabase.from("units").select("id, code"),
    supabase.from("courses").select("id, name"),
  ]);
  if (!reportRows?.length) return [];

  const carrierCodeById = new Map<string, string>();
  const carrierNameById = new Map<string, string>();
  (carrierRows ?? []).forEach((c: { id: string; code: string | null; name: string | null }) => {
    carrierCodeById.set(c.id, c.code ?? "");
    carrierNameById.set(c.id, c.name ?? "");
  });
  const courseNameById = new Map<string, string>();
  (courseRows ?? []).forEach((c: { id: string; name: string | null }) =>
    courseNameById.set(c.id, c.name ?? ""),
  );
  const unitCodeById = new Map<string, string>();
  (unitRows ?? []).forEach((u: { id: string; code: string | null }) =>
    unitCodeById.set(u.id, u.code ?? ""),
  );

  // 車両プレート埋め込み（withVehicle 時）
  const vehicleById = new Map<string, VehiclePlatePayload>();
  if (options.withVehicle) {
    const vIds = Array.from(
      new Set(
        reportRows
          .map((r: { vehicle_id: string | null }) => r.vehicle_id)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    if (vIds.length) {
      const { data: vRows } = await supabase
        .from("vehicles")
        .select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand")
        .in("id", vIds);
      (vRows ?? []).forEach((v: VehiclePlatePayload) => vehicleById.set(v.id, v));
    }
  }

  const ids = reportRows.map((r: { id: string }) => r.id);
  const entriesByReport = new Map<string, { unitId: string; fieldKey: string; valueNum: number }[]>();
  for (let i = 0; i < ids.length; i += 1000) {
    const slice = ids.slice(i, i + 1000);
    const entRows = await fetchAllRows((from, to) =>
      supabase
        .from("report_entries")
        .select("report_id, unit_id, field_key, value_num")
        .in("report_id", slice)
        .range(from, to),
    );
    entRows.forEach(
      (e: { report_id: string; unit_id: string; field_key: string; value_num: number | null }) => {
        const arr = entriesByReport.get(e.report_id) ?? [];
        arr.push({ unitId: e.unit_id, fieldKey: e.field_key, valueNum: Number(e.value_num) || 0 });
        entriesByReport.set(e.report_id, arr);
      },
    );
  }

  return reportRows.map(
    (r: {
      id: string;
      legacy_report_id: string | null;
      driver_id: string;
      identity_id: string | null;
      report_date: string;
      course_id: string | null;
      carrier_id: string | null;
      vehicle_id: string | null;
      meter_value: number | null;
      submitted_at: string | null;
      approved_at: string | null;
      approved_by: string | null;
      rejected_at: string | null;
      rejected_by: string | null;
    }) => {
      const counts = zeroCounts();
      for (const e of entriesByReport.get(r.id) ?? []) {
        const code = unitCodeById.get(e.unitId);
        if (!code) continue;
        const col = COLUMN_BY_UNIT_FIELD[`${code}:${e.fieldKey}`];
        if (col) (counts as Record<string, number>)[col] += e.valueNum;
      }
      return {
        id: options.idSource === "v2" ? r.id : r.legacy_report_id ?? r.id,
        ...(options.withVehicle
          ? { vehicles: (r.vehicle_id && vehicleById.get(r.vehicle_id)) || null }
          : {}),
        driver_id: r.driver_id,
        driver_identity_id: r.identity_id,
        report_date: r.report_date,
        course_id: r.course_id,
        course_name: (r.course_id && courseNameById.get(r.course_id)) || null,
        carrier: (r.carrier_id && carrierCodeById.get(r.carrier_id)) || "YAMATO",
        carrier_id: r.carrier_id,
        carrier_name: (r.carrier_id && carrierNameById.get(r.carrier_id)) || null,
        ...counts,
        vehicle_id: r.vehicle_id,
        meter_value: r.meter_value,
        submitted_at: r.submitted_at,
        approved_at: r.approved_at,
        approved_by: r.approved_by,
        rejected_at: r.rejected_at,
        rejected_by: r.rejected_by,
      };
    },
  );
}
