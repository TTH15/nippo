// ============================================================
// チーム戦（イベント）: 採点ロジックの型定義
// events.scoring_rule(jsonb) の形をここで定義し、
// サーバー採点(score.ts)・API・クライアント編集UIで共有する（SSOT）。
// DB 非依存の純データ型のみ（score.ts も Supabase に依存しない）。
// ============================================================

/** 採点対象の報告フィールド（unit × field の厳密指定） */
export type ScoringField = {
  unitId: string;
  fieldKey: string;
};

/** 1つの採点ルール（報告項目の数量 × ポイント） */
export type ScoringRule = {
  /** クライアント採番の安定ID（UI の key・差分に使用） */
  id: string;
  /** 表示名（例「完了個数」） */
  label: string;
  /** 対象フィールド（複数可・キャリア/型横断OK）。同一reportで重複合算を避けるため集合扱い */
  fields: ScoringField[];
  /** 1数量あたりのポイント（負・小数可。持戻 = -2 等） */
  pointsPer: number;
};

/** events.scoring_rule の jsonb 形 */
export type ScoringRuleSet = {
  version: 1;
  rules: ScoringRule[];
};

export function emptyScoringRuleSet(): ScoringRuleSet {
  return { version: 1, rules: [] };
}

/** 未知/空の jsonb を安全に ScoringRuleSet へ正規化 */
export function normalizeScoringRuleSet(raw: unknown): ScoringRuleSet {
  if (!raw || typeof raw !== "object") return emptyScoringRuleSet();
  const obj = raw as { rules?: unknown };
  if (!Array.isArray(obj.rules)) return emptyScoringRuleSet();
  const rules: ScoringRule[] = [];
  for (const r of obj.rules) {
    if (!r || typeof r !== "object") continue;
    const rr = r as Partial<ScoringRule>;
    const fields = Array.isArray(rr.fields)
      ? rr.fields
          .filter((f): f is ScoringField =>
            Boolean(f) &&
            typeof (f as ScoringField).unitId === "string" &&
            typeof (f as ScoringField).fieldKey === "string",
          )
          .map((f) => ({ unitId: f.unitId, fieldKey: f.fieldKey }))
      : [];
    rules.push({
      id: typeof rr.id === "string" && rr.id ? rr.id : `rule_${rules.length + 1}`,
      label: typeof rr.label === "string" ? rr.label : "",
      fields,
      pointsPer: Number.isFinite(Number(rr.pointsPer)) ? Number(rr.pointsPer) : 0,
    });
  }
  return { version: 1, rules };
}

// ---- 採点入力（DB から正規化した純データ） ----

export type EventTeam = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
};

export type EventMember = {
  driverId: string;
  teamId: string;
};

/** 手動ポイント（event_point_entries source='manual'） */
export type ManualPointEntry = {
  teamId: string | null;
  driverId: string | null;
  points: number;
  reason: string | null;
  entryDate: string | null;
};

/** 採点に使う報告（承認判定は score 側で isCountableReport を使う） */
export type ScoringReport = {
  driverId: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  entries: { unitId: string; fieldKey: string; valueNum: number }[];
};

// ---- 採点結果 ----

export type RuleBreakdown = {
  ruleId: string;
  label: string;
  /** このルールで得た数量合計 */
  quantity: number;
  /** このルールで得たポイント（pointsPer × quantity） */
  points: number;
};

export type DriverScore = {
  driverId: string;
  teamId: string | null;
  /** 自動採点（報告項目由来） */
  autoPoints: number;
  /** 手動加点（driver_id 指定分） */
  manualPoints: number;
  total: number;
  breakdown: RuleBreakdown[];
};

export type TeamScore = {
  teamId: string;
  name: string;
  color: string;
  /** メンバーの total 合計 */
  memberPoints: number;
  /** チームレベルの手動加点（driver_id null・team_id 指定） */
  teamManualPoints: number;
  total: number;
  /** 所属メンバーの DriverScore（total 降順） */
  members: DriverScore[];
};

export type EventScoreResult = {
  teams: TeamScore[];
  /** 個人MVP（チーム所属メンバーのみ・total 降順） */
  individuals: DriverScore[];
};
