import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 送信後画面（今日の報酬見込み＋ランキング）の設定アクセス。
// 単一行運用。migration 061 未適用でも既定値で動くよう耐性を持たせる。
// ============================================================

export type MetricField = { unitId: string; fieldKey: string };

export type SubmitScreenConfig = {
  metricLabel: string;
  metricFields: MetricField[];
  targetDriverIds: string[];
  period: "current_month";
  showRanking: boolean;
};

export function defaultSubmitScreenConfig(): SubmitScreenConfig {
  return {
    metricLabel: "完了個数",
    metricFields: [],
    targetDriverIds: [],
    period: "current_month",
    showRanking: true,
  };
}

function normalizeFields(raw: unknown): MetricField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is MetricField =>
        Boolean(f) &&
        typeof (f as MetricField).unitId === "string" &&
        typeof (f as MetricField).fieldKey === "string",
    )
    .map((f) => ({ unitId: f.unitId, fieldKey: f.fieldKey }));
}

/** 設定を取得（行が無い/テーブル未作成なら既定値）。 */
export async function loadSubmitScreenConfig(supabase: SupabaseClient): Promise<SubmitScreenConfig> {
  try {
    const { data, error } = await supabase
      .from("submit_screen_config")
      .select("metric_label, metric_fields, target_driver_ids, period, show_ranking")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return defaultSubmitScreenConfig();
    return {
      metricLabel: String(data.metric_label ?? "完了個数"),
      metricFields: normalizeFields(data.metric_fields),
      targetDriverIds: Array.isArray(data.target_driver_ids)
        ? data.target_driver_ids.filter((x: unknown): x is string => typeof x === "string")
        : [],
      period: "current_month",
      showRanking: data.show_ranking !== false,
    };
  } catch {
    return defaultSubmitScreenConfig();
  }
}

/** 設定を保存（単一行 upsert）。 */
export async function saveSubmitScreenConfig(
  supabase: SupabaseClient,
  cfg: SubmitScreenConfig,
): Promise<void> {
  const { data: existing } = await supabase
    .from("submit_screen_config")
    .select("id")
    .limit(1)
    .maybeSingle();
  const row = {
    metric_label: cfg.metricLabel,
    metric_fields: cfg.metricFields,
    target_driver_ids: cfg.targetDriverIds,
    period: "current_month",
    show_ranking: cfg.showRanking,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    await supabase.from("submit_screen_config").update(row).eq("id", existing.id);
  } else {
    await supabase.from("submit_screen_config").insert(row);
  }
}
