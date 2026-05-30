// チーム戦（イベント）管理UIの共有型。scoring_rule の形はサーバーと共有。
import type {
  ScoringRuleSet,
  TeamScore,
  DriverScore,
} from "@/server/events/types";

export type EventStatus = "draft" | "active" | "closed";

export type EventListItem = {
  id: string;
  name: string;
  description: string;
  starts_on: string | null;
  ends_on: string | null;
  status: EventStatus;
  created_at: string;
};

export type EventDetailData = EventListItem & {
  scoring_rule: ScoringRuleSet;
};

export type EventTeamRow = {
  id: string;
  event_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

export type EventMemberRow = {
  id: string;
  team_id: string;
  driver_id: string;
};

export type DriverRow = {
  id: string;
  name: string;
  display_name: string | null;
};

export type UnitFieldRow = {
  id: string;
  unit_id: string;
  field_key: string;
  label: string;
  input_type: string;
  group_label: string | null;
};

export type UnitTreeRow = {
  id: string;
  carrier_id: string;
  code: string | null;
  fields: UnitFieldRow[];
};

export type CarrierTreeRow = {
  id: string;
  name: string;
  units: UnitTreeRow[];
};

export type EventDetailResponse = {
  event: EventDetailData;
  teams: EventTeamRow[];
  members: EventMemberRow[];
  drivers: DriverRow[];
  carriers: CarrierTreeRow[];
};

export type ManualPointRow = {
  id: string;
  team_id: string | null;
  driver_id: string | null;
  entry_date: string | null;
  points: number;
  reason: string | null;
  source: string;
  created_at: string;
};

export type RankingResponse = {
  teams: TeamScore[];
  individuals: DriverScore[];
  driverNames: Record<string, string>;
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "下書き",
  active: "開催中",
  closed: "終了",
};
