// 送信後画面ブロックの共有型（サーバ/クライアント両用・ランタイム依存なし）。

export type MetricField = { unitId: string; fieldKey: string };

export type BlockType = "greeting" | "today_reward" | "event_points" | "personal_count" | "personal_ranking";

type BaseBlock = { id: string; type: BlockType; enabled: boolean };

export type GreetingBlock = BaseBlock & { type: "greeting"; title: string; message: string };
export type RewardBlock = BaseBlock & { type: "today_reward" };
export type EventPointsBlock = BaseBlock & {
  type: "event_points";
  source: "auto" | "event";
  eventId: string | null;
  showRanking: boolean;
};

/** 個人系の集計フィルタ。 */
export type PersonalFilter = {
  metricFields: MetricField[];
  carrierIds: string[];
  targetDriverIds: string[];
};
export type PersonalCountBlock = BaseBlock & { type: "personal_count"; label: string } & PersonalFilter;
export type PersonalRankingBlock = BaseBlock & { type: "personal_ranking"; label: string } & PersonalFilter;

export type SubmitBlock =
  | GreetingBlock
  | RewardBlock
  | EventPointsBlock
  | PersonalCountBlock
  | PersonalRankingBlock;

// --- 解決後（ドライバー向け描画データ） ---
export type ResolvedTeamRow = { rank: number; teamId: string; name: string; color: string; total: number };
export type ResolvedIndivRow = { rank: number; name: string; total: number; isMe: boolean };
export type ResolvedRankRow = { rank: number; name: string; value: number; isMe: boolean };

export type ResolvedBlock =
  | { id: string; type: "greeting"; title: string; message: string }
  | { id: string; type: "today_reward"; todayReward: number }
  | {
      id: string;
      type: "event_points";
      eventName: string;
      myTeam: { id: string; name: string; color: string; total: number } | null;
      myTeamId: string | null;
      todayPoints: number;
      showRanking: boolean;
      rankingVisible: boolean;
      teams: ResolvedTeamRow[];
      individuals: ResolvedIndivRow[];
    }
  | { id: string; type: "personal_count"; label: string; value: number }
  | {
      id: string;
      type: "personal_ranking";
      label: string;
      configured: boolean;
      ranking: ResolvedRankRow[];
      myRank: ResolvedRankRow | null;
      total: number;
    };
