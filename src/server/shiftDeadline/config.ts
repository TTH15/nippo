import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DEADLINE_CONFIG,
  type DeadlineConfig,
  type DeadlineOverride,
  type DriverDeadline,
  type Half,
} from "@/lib/shiftDeadline";

// ============================================================
// 希望休 提出締切の設定アクセス（単一行 config + 期間例外 overrides）。
// migration 066 未適用でも既定値で動くよう耐性を持たせる。
// ============================================================

export function defaultDeadlineConfig(): DeadlineConfig {
  return { ...DEFAULT_DEADLINE_CONFIG };
}

const toInt = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** 既定ルールを取得（行が無い/テーブル未作成なら既定値）。 */
export async function loadDeadlineConfig(supabase: SupabaseClient): Promise<DeadlineConfig> {
  try {
    const { data, error } = await supabase
      .from("shift_request_deadline_config")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return defaultDeadlineConfig();
    const d = defaultDeadlineConfig();
    return {
      firstHalfEndDay: toInt(data.first_half_end_day, d.firstHalfEndDay),
      firstHalfDeadlineMonthOffset: toInt(
        data.first_half_deadline_month_offset,
        d.firstHalfDeadlineMonthOffset,
      ),
      firstHalfDeadlineDay: toInt(data.first_half_deadline_day, d.firstHalfDeadlineDay),
      secondHalfDeadlineMonthOffset: toInt(
        data.second_half_deadline_month_offset,
        d.secondHalfDeadlineMonthOffset,
      ),
      secondHalfDeadlineDay: toInt(data.second_half_deadline_day, d.secondHalfDeadlineDay),
    };
  } catch {
    return defaultDeadlineConfig();
  }
}

/** 既定ルールを保存（単一行 upsert）。 */
export async function saveDeadlineConfig(
  supabase: SupabaseClient,
  cfg: DeadlineConfig,
): Promise<void> {
  const { data: existing } = await supabase
    .from("shift_request_deadline_config")
    .select("id")
    .limit(1)
    .maybeSingle();
  const row = {
    first_half_end_day: cfg.firstHalfEndDay,
    first_half_deadline_month_offset: cfg.firstHalfDeadlineMonthOffset,
    first_half_deadline_day: cfg.firstHalfDeadlineDay,
    second_half_deadline_month_offset: cfg.secondHalfDeadlineMonthOffset,
    second_half_deadline_day: cfg.secondHalfDeadlineDay,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    await supabase.from("shift_request_deadline_config").update(row).eq("id", existing.id);
  } else {
    await supabase.from("shift_request_deadline_config").insert(row);
  }
}

const HALVES: Half[] = ["FIRST", "SECOND"];

/** 期間例外の一覧（テーブル未作成なら空配列）。 */
export async function loadDeadlineOverrides(
  supabase: SupabaseClient,
): Promise<DeadlineOverride[]> {
  try {
    const { data, error } = await supabase
      .from("shift_request_deadline_overrides")
      .select("target_year, target_month, half, deadline_date, note")
      .order("target_year")
      .order("target_month")
      .order("half");
    if (error || !data) return [];
    return data
      .filter((r: { half: string }) => HALVES.includes(r.half as Half))
      .map((r: {
        target_year: number;
        target_month: number;
        half: string;
        deadline_date: string;
        note: string | null;
      }) => ({
        targetYear: toInt(r.target_year, 0),
        targetMonth: toInt(r.target_month, 0),
        half: r.half as Half,
        deadlineDate: String(r.deadline_date).slice(0, 10),
        note: r.note ?? null,
      }));
  } catch {
    return [];
  }
}

/** 期間例外を全置換で保存（送られた集合に揃える）。 */
export async function saveDeadlineOverrides(
  supabase: SupabaseClient,
  overrides: DeadlineOverride[],
): Promise<void> {
  // 既存を全削除 → 入れ直し（件数は十数件程度の想定）
  await supabase
    .from("shift_request_deadline_overrides")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (overrides.length === 0) return;
  const rows = overrides.map((o) => ({
    target_year: o.targetYear,
    target_month: o.targetMonth,
    half: o.half,
    deadline_date: o.deadlineDate,
    note: o.note ?? null,
    updated_at: new Date().toISOString(),
  }));
  await supabase.from("shift_request_deadline_overrides").insert(rows);
}

// ============================================================
// ドライバーごとの締切（migration 074）。テーブル未作成でも安全に空で動く。
// ============================================================

export type DriverDeadlineOverride = DeadlineOverride & { driverId: string };

/** 行から DeadlineConfig（個別既定ルール）を組む。firstHalfEndDay は全体に従うので既定値。 */
function ruleFromRow(data: Record<string, unknown>): DeadlineConfig {
  const d = defaultDeadlineConfig();
  return {
    firstHalfEndDay: d.firstHalfEndDay,
    firstHalfDeadlineMonthOffset: toInt(data.first_half_deadline_month_offset, d.firstHalfDeadlineMonthOffset),
    firstHalfDeadlineDay: toInt(data.first_half_deadline_day, d.firstHalfDeadlineDay),
    secondHalfDeadlineMonthOffset: toInt(data.second_half_deadline_month_offset, d.secondHalfDeadlineMonthOffset),
    secondHalfDeadlineDay: toInt(data.second_half_deadline_day, d.secondHalfDeadlineDay),
  };
}

const mapOverrideRow = (r: {
  target_year: number;
  target_month: number;
  half: string;
  deadline_date: string;
  note: string | null;
}): DeadlineOverride => ({
  targetYear: toInt(r.target_year, 0),
  targetMonth: toInt(r.target_month, 0),
  half: r.half as Half,
  deadlineDate: String(r.deadline_date).slice(0, 10),
  note: r.note ?? null,
});

/** 1ドライバー分の個別締切（rule + overrides）。無ければ rule=null / overrides=[]。 */
export async function loadDriverDeadline(
  supabase: SupabaseClient,
  driverId: string,
): Promise<DriverDeadline> {
  try {
    const [{ data: ruleRow }, { data: ovRows }] = await Promise.all([
      supabase.from("shift_request_deadline_driver_rules").select("*").eq("driver_id", driverId).maybeSingle(),
      supabase
        .from("shift_request_deadline_driver_overrides")
        .select("target_year, target_month, half, deadline_date, note")
        .eq("driver_id", driverId),
    ]);
    return {
      rule: ruleRow ? ruleFromRow(ruleRow) : null,
      overrides: (ovRows ?? []).filter((r) => HALVES.includes(r.half as Half)).map(mapOverrideRow),
    };
  } catch {
    return { rule: null, overrides: [] };
  }
}

/** 全ドライバーの個別締切（管理画面用）。rules は driver_id→ルール、overrides は driverId 付き。 */
export async function loadAllDriverDeadlines(
  supabase: SupabaseClient,
): Promise<{ rules: Record<string, DeadlineConfig>; overrides: DriverDeadlineOverride[] }> {
  try {
    const [{ data: ruleRows }, { data: ovRows }] = await Promise.all([
      supabase.from("shift_request_deadline_driver_rules").select("*"),
      supabase
        .from("shift_request_deadline_driver_overrides")
        .select("driver_id, target_year, target_month, half, deadline_date, note"),
    ]);
    const rules: Record<string, DeadlineConfig> = {};
    for (const r of ruleRows ?? []) rules[String(r.driver_id)] = ruleFromRow(r);
    const overrides: DriverDeadlineOverride[] = (ovRows ?? [])
      .filter((r) => HALVES.includes(r.half as Half))
      .map((r) => ({ driverId: String(r.driver_id), ...mapOverrideRow(r) }));
    return { rules, overrides };
  } catch {
    return { rules: {}, overrides: [] };
  }
}

/** ドライバー個別の締切を全置換で保存。 */
export async function saveDriverDeadlines(
  supabase: SupabaseClient,
  rules: Record<string, DeadlineConfig>,
  overrides: DriverDeadlineOverride[],
): Promise<void> {
  // 個別ルール（全置換）。行を持つドライバー＝個別設定あり。
  await supabase
    .from("shift_request_deadline_driver_rules")
    .delete()
    .neq("driver_id", "00000000-0000-0000-0000-000000000000");
  const ruleRows = Object.entries(rules).map(([driverId, c]) => ({
    driver_id: driverId,
    first_half_deadline_month_offset: c.firstHalfDeadlineMonthOffset,
    first_half_deadline_day: c.firstHalfDeadlineDay,
    second_half_deadline_month_offset: c.secondHalfDeadlineMonthOffset,
    second_half_deadline_day: c.secondHalfDeadlineDay,
    updated_at: new Date().toISOString(),
  }));
  if (ruleRows.length > 0) await supabase.from("shift_request_deadline_driver_rules").insert(ruleRows);

  // 個別期間例外（全置換）。
  await supabase
    .from("shift_request_deadline_driver_overrides")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (overrides.length > 0) {
    const rows = overrides.map((o) => ({
      driver_id: o.driverId,
      target_year: o.targetYear,
      target_month: o.targetMonth,
      half: o.half,
      deadline_date: o.deadlineDate,
      note: o.note ?? null,
      updated_at: new Date().toISOString(),
    }));
    await supabase.from("shift_request_deadline_driver_overrides").insert(rows);
  }
}
