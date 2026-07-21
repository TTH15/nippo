import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DEADLINE_CONFIG,
  type DeadlineConfig,
  type DeadlineOverride,
  type DeadlineRule,
  type RulePeriod,
  type RulePeriodOverride,
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
export async function loadDeadlineConfig(
  supabase: SupabaseClient,
  orgId: string,
): Promise<DeadlineConfig> {
  try {
    const { data, error } = await supabase
      .from("shift_request_deadline_config")
      .select("*")
      .eq("org_id", orgId)
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
  orgId: string,
  cfg: DeadlineConfig,
): Promise<void> {
  const { data: existing } = await supabase
    .from("shift_request_deadline_config")
    .select("id")
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();
  const row = {
    org_id: orgId,
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
    // tenant-scope-ok: row に org_id を含む
    await supabase.from("shift_request_deadline_config").insert(row);
  }
}

const HALVES: Half[] = ["FIRST", "SECOND"];

/** 期間例外の一覧（テーブル未作成なら空配列）。 */
export async function loadDeadlineOverrides(
  supabase: SupabaseClient,
  orgId: string,
): Promise<DeadlineOverride[]> {
  try {
    const { data, error } = await supabase
      .from("shift_request_deadline_overrides")
      .select("target_year, target_month, half, deadline_date, note")
      .eq("org_id", orgId)
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
  orgId: string,
  overrides: DeadlineOverride[],
): Promise<void> {
  // 既存を全削除 → 入れ直し（このテナント分のみ。件数は十数件程度の想定）
  await supabase
    .from("shift_request_deadline_overrides")
    .delete()
    .eq("org_id", orgId);
  if (overrides.length === 0) return;
  const rows = overrides.map((o) => ({
    org_id: orgId,
    target_year: o.targetYear,
    target_month: o.targetMonth,
    half: o.half,
    deadline_date: o.deadlineDate,
    note: o.note ?? null,
    updated_at: new Date().toISOString(),
  }));
  // tenant-scope-ok: rows の各行に org_id を含む
  await supabase.from("shift_request_deadline_overrides").insert(rows);
}

// ============================================================
// 締切ルール（migration 075）。ルール＝名前＋提出期間リスト＋期間例外。ドライバー→ルール割り当て。
// ============================================================

/** 管理画面用のルール（割り当てドライバーID付き）。 */
export type DeadlineRuleFull = DeadlineRule & { sortOrder: number; driverIds: string[] };

/** 保存用のルール入力（id無し。配列順で seq を採番）。 */
export type DeadlineRuleInput = {
  name: string;
  periods: Omit<RulePeriod, "seq">[];
  overrides: RulePeriodOverride[];
  driverIds: string[];
};

const mapPeriodRow = (p: {
  seq: number;
  start_day: number;
  end_day: number;
  deadline_month_offset: number;
  deadline_day: number;
}): RulePeriod => ({
  seq: toInt(p.seq, 0),
  startDay: toInt(p.start_day, 1),
  endDay: toInt(p.end_day, 31),
  deadlineMonthOffset: toInt(p.deadline_month_offset, -1),
  deadlineDay: toInt(p.deadline_day, 23),
});

const mapRuleOverrideRow = (o: {
  target_year: number;
  target_month: number;
  period_seq: number;
  deadline_date: string;
  note: string | null;
}): RulePeriodOverride => ({
  targetYear: toInt(o.target_year, 0),
  targetMonth: toInt(o.target_month, 0),
  periodSeq: toInt(o.period_seq, 0),
  deadlineDate: String(o.deadline_date).slice(0, 10),
  note: o.note ?? null,
});

/** ドライバーに割り当てられたルール（無ければ null＝常にオープン）。 */
export async function loadDriverRule(
  supabase: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<DeadlineRule | null> {
  try {
    const { data: asg } = await supabase
      .from("shift_request_deadline_rule_assignments")
      .select("rule_id")
      .eq("driver_id", driverId)
      .maybeSingle();
    const ruleId = asg?.rule_id as string | undefined;
    if (!ruleId) return null;
    const [{ data: rule }, { data: periods }, { data: ovs }] = await Promise.all([
      supabase.from("shift_request_deadline_rules").select("id, name").eq("id", ruleId).eq("org_id", orgId).maybeSingle(),
      supabase
        .from("shift_request_deadline_rule_periods")
        .select("seq, start_day, end_day, deadline_month_offset, deadline_day")
        .eq("rule_id", ruleId)
        .order("seq"),
      supabase
        .from("shift_request_deadline_rule_overrides")
        .select("target_year, target_month, period_seq, deadline_date, note")
        .eq("rule_id", ruleId),
    ]);
    if (!rule) return null;
    return {
      id: String(rule.id),
      name: rule.name ?? "",
      periods: (periods ?? []).map(mapPeriodRow),
      overrides: (ovs ?? []).map(mapRuleOverrideRow),
    };
  } catch {
    return null;
  }
}

/** 全ルール（管理画面用）。 */
export async function loadAllRules(supabase: SupabaseClient, orgId: string): Promise<DeadlineRuleFull[]> {
  try {
    const [{ data: rules }, { data: periods }, { data: ovs }, { data: asgs }] = await Promise.all([
      supabase.from("shift_request_deadline_rules").select("id, name, sort_order").eq("org_id", orgId).order("sort_order"),
      supabase
        .from("shift_request_deadline_rule_periods")
        .select("rule_id, seq, start_day, end_day, deadline_month_offset, deadline_day")
        .order("seq"),
      supabase
        .from("shift_request_deadline_rule_overrides")
        .select("rule_id, target_year, target_month, period_seq, deadline_date, note"),
      supabase.from("shift_request_deadline_rule_assignments").select("driver_id, rule_id"),
    ]);
    return (rules ?? []).map((r) => ({
      id: String(r.id),
      name: r.name ?? "",
      sortOrder: toInt(r.sort_order, 0),
      periods: (periods ?? []).filter((p) => p.rule_id === r.id).map(mapPeriodRow),
      overrides: (ovs ?? []).filter((o) => o.rule_id === r.id).map(mapRuleOverrideRow),
      driverIds: (asgs ?? []).filter((a) => a.rule_id === r.id).map((a) => String(a.driver_id)),
    }));
  } catch {
    return [];
  }
}

/** ルールを全置換で保存（rules / periods / overrides / assignments）。 */
export async function saveRules(supabase: SupabaseClient, orgId: string, rules: DeadlineRuleInput[]): Promise<void> {
  const now = new Date().toISOString();
  // このテナントの既存ルール群だけを依存順に全削除（他テナントのルールは消さない）。
  // 子テーブル（periods/overrides/assignments）に org_id は無いため、当org の rule_id 配下に限定する。
  const { data: orgRules } = await supabase
    .from("shift_request_deadline_rules")
    .select("id")
    .eq("org_id", orgId);
  const orgRuleIds = (orgRules ?? []).map((r) => String(r.id));
  if (orgRuleIds.length > 0) {
    await supabase.from("shift_request_deadline_rule_assignments").delete().in("rule_id", orgRuleIds);
    await supabase.from("shift_request_deadline_rule_overrides").delete().in("rule_id", orgRuleIds);
    await supabase.from("shift_request_deadline_rule_periods").delete().in("rule_id", orgRuleIds);
  }
  await supabase.from("shift_request_deadline_rules").delete().eq("org_id", orgId);

  const assigned = new Set<string>();
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const { data: ins } = await supabase
      .from("shift_request_deadline_rules")
      .insert({ org_id: orgId, name: r.name, sort_order: i, updated_at: now })
      .select("id")
      .single();
    const ruleId = ins?.id as string | undefined;
    if (!ruleId) continue;

    if (r.periods.length > 0) {
      await supabase.from("shift_request_deadline_rule_periods").insert(
        r.periods.map((p, seq) => ({
          rule_id: ruleId,
          seq,
          start_day: p.startDay,
          end_day: p.endDay,
          deadline_month_offset: p.deadlineMonthOffset,
          deadline_day: p.deadlineDay,
          updated_at: now,
        })),
      );
    }
    if (r.overrides.length > 0) {
      await supabase.from("shift_request_deadline_rule_overrides").insert(
        r.overrides.map((o) => ({
          rule_id: ruleId,
          target_year: o.targetYear,
          target_month: o.targetMonth,
          period_seq: o.periodSeq,
          deadline_date: o.deadlineDate,
          note: o.note ?? null,
          updated_at: now,
        })),
      );
    }
    const drv = r.driverIds.filter((d) => !assigned.has(d));
    drv.forEach((d) => assigned.add(d));
    if (drv.length > 0) {
      await supabase
        .from("shift_request_deadline_rule_assignments")
        .insert(drv.map((d) => ({ driver_id: d, rule_id: ruleId, updated_at: now })));
    }
  }
}
