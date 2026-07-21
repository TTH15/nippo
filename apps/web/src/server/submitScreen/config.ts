import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubmitBlock } from "./blocks";

// ============================================================
// 送信後画面（今日の報酬見込み＋ランキング）の設定アクセス。
// 単一行運用。migration 061 未適用でも既定値で動くよう耐性を持たせる。
// ============================================================

export type MetricField = { unitId: string; fieldKey: string };

/** 送信後ランキングの表示ソース。 */
export type RankingSource = "auto" | "event" | "individual" | "none";

const RANKING_SOURCES: RankingSource[] = ["auto", "event", "individual", "none"];

export function normalizeRankingSource(raw: unknown, fallback: RankingSource = "auto"): RankingSource {
  return RANKING_SOURCES.includes(raw as RankingSource) ? (raw as RankingSource) : fallback;
}

export type SubmitScreenConfig = {
  metricLabel: string;
  metricFields: MetricField[];
  targetDriverIds: string[];
  period: "current_month";
  /** ランキングの表示ソース。none=非表示。auto=期間内activeイベント自動／なければ個人。 */
  rankingSource: RankingSource;
  /** rankingSource='event' のとき使うイベント（期間に関係なく使用）。 */
  linkedEventId: string | null;
  /** 送信後画面の見出し文言（例: お疲れさまでした）。 */
  thanksTitle: string;
  /** 送信後画面の補足文言。 */
  thanksMessage: string;
  /** 後方互換: rankingSource !== 'none' と同義。 */
  showRanking: boolean;
  /** ドライバーにチーム順位を公開するか（false=自チームのポイントのみ）。グローバル既定。 */
  teamRankingVisibleToDrivers: boolean;
  /** 送信後画面のブロック構成。null=従来フラット設定から導出。 */
  blocks: SubmitBlock[] | null;
  /** 送信フォーム上部の注意バナー（運営設定・期間指定）。 */
  formNotice: FormNotice;
};

/** 送信フォーム上部の注意バナー設定。 */
export type FormNotice = {
  enabled: boolean;
  message: string;
  /** 表示開始日 "YYYY-MM-DD"（null=下限なし）。 */
  startDate: string | null;
  /** 表示終了日 "YYYY-MM-DD"（null=上限なし、当日を含む）。 */
  endDate: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // DB の date は "YYYY-MM-DD"。timestamptz 等で来た場合も先頭10文字を採用。
  const s = raw.slice(0, 10);
  return DATE_RE.test(s) ? s : null;
}

export function defaultFormNotice(): FormNotice {
  return { enabled: false, message: "", startDate: null, endDate: null };
}

export function normalizeFormNotice(raw: unknown): FormNotice {
  const r = (raw ?? {}) as Partial<Record<keyof FormNotice, unknown>>;
  return {
    enabled: r.enabled === true,
    message: typeof r.message === "string" ? r.message.slice(0, 500) : "",
    startDate: normalizeDate(r.startDate),
    endDate: normalizeDate(r.endDate),
  };
}

/** 注意バナーを指定日に表示すべきか（enabled かつ期間内、message 非空）。 */
export function isFormNoticeActiveOn(notice: FormNotice, dateStr: string): boolean {
  if (!notice.enabled) return false;
  if (!notice.message.trim()) return false;
  if (notice.startDate && dateStr < notice.startDate) return false;
  if (notice.endDate && dateStr > notice.endDate) return false;
  return true;
}

export function defaultSubmitScreenConfig(): SubmitScreenConfig {
  return {
    metricLabel: "完了個数",
    metricFields: [],
    targetDriverIds: [],
    period: "current_month",
    rankingSource: "auto",
    linkedEventId: null,
    thanksTitle: "お疲れさまでした",
    thanksMessage: "",
    showRanking: true,
    teamRankingVisibleToDrivers: false,
    blocks: null,
    formNotice: defaultFormNotice(),
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
export async function loadSubmitScreenConfig(
  supabase: SupabaseClient,
  orgId: string,
): Promise<SubmitScreenConfig> {
  try {
    // select("*") にして 065 未適用でも安全（新カラムが無ければ undefined → 既定）
    const { data, error } = await supabase
      .from("submit_screen_config")
      .select("*")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return defaultSubmitScreenConfig();
    // ranking_source（067）未適用なら show_ranking から導出。
    const rankingSource = normalizeRankingSource(
      data.ranking_source,
      data.show_ranking === false ? "none" : "auto",
    );
    return {
      metricLabel: String(data.metric_label ?? "完了個数"),
      metricFields: normalizeFields(data.metric_fields),
      targetDriverIds: Array.isArray(data.target_driver_ids)
        ? data.target_driver_ids.filter((x: unknown): x is string => typeof x === "string")
        : [],
      period: "current_month",
      rankingSource,
      linkedEventId: typeof data.linked_event_id === "string" ? data.linked_event_id : null,
      thanksTitle: typeof data.thanks_title === "string" ? data.thanks_title : "お疲れさまでした",
      thanksMessage: typeof data.thanks_message === "string" ? data.thanks_message : "",
      showRanking: rankingSource !== "none",
      teamRankingVisibleToDrivers: data.team_ranking_visible_to_drivers === true,
      blocks: Array.isArray(data.blocks) ? (data.blocks as SubmitBlock[]) : null,
      // 081 未適用なら各カラム undefined → 既定（無効）。
      formNotice: normalizeFormNotice({
        enabled: data.form_notice_enabled,
        message: data.form_notice_message,
        startDate: data.form_notice_start,
        endDate: data.form_notice_end,
      }),
    };
  } catch {
    return defaultSubmitScreenConfig();
  }
}

/** 設定を保存（単一行 upsert）。 */
export async function saveSubmitScreenConfig(
  supabase: SupabaseClient,
  orgId: string,
  cfg: SubmitScreenConfig,
): Promise<void> {
  const { data: existing } = await supabase
    .from("submit_screen_config")
    .select("id")
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();
  const row = {
    org_id: orgId,
    metric_label: cfg.metricLabel,
    metric_fields: cfg.metricFields,
    target_driver_ids: cfg.targetDriverIds,
    period: "current_month",
    ranking_source: cfg.rankingSource,
    linked_event_id: cfg.linkedEventId,
    thanks_title: cfg.thanksTitle,
    thanks_message: cfg.thanksMessage,
    // 後方互換: ranking_source から show_ranking を導出して保存。
    show_ranking: cfg.rankingSource !== "none",
    team_ranking_visible_to_drivers: cfg.teamRankingVisibleToDrivers,
    blocks: cfg.blocks,
    form_notice_enabled: cfg.formNotice.enabled,
    form_notice_message: cfg.formNotice.message,
    form_notice_start: cfg.formNotice.startDate,
    form_notice_end: cfg.formNotice.endDate,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    await supabase.from("submit_screen_config").update(row).eq("id", existing.id);
  } else {
    await supabase.from("submit_screen_config").insert(row); // tenant-scope-ok: row に org_id を含む
  }
}
