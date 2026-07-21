// ============================================================
// 通知の文面生成（純粋関数）。
// 設計: docs/notification-flow.md §5「文面生成は純粋ロジック core/logic に置き
//       Web/RN/種別で再利用」。DB にも fetch にも触れない。
//
// 実効値の規則（roadmap A2）: shifts の上書き列が NULL ならコース標準を使う
//   実効値 = shifts.* ?? courses.*
// ============================================================

/** DB の time 型（"08:00:00"）を表示用（"08:00"）に丸める。 */
export function toDisplayTime(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

export type PlateParts = {
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
};

/**
 * ナンバープレートを1行の文字列にする（通知本文用）。
 * 画面の VehiclePlate と違い、テキストなので素朴に連結する。
 */
export function formatPlateOneLine(vehicle: PlateParts | null | undefined): string | null {
  if (!vehicle) return null;
  const parts = [
    vehicle.number_prefix,
    vehicle.number_class,
    vehicle.number_hiragana,
    vehicle.number_numeric,
  ]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "");
  return parts.length > 0 ? parts.join(" ") : null;
}

export type AssignmentInput = {
  /** 表示するコース名（略記があればそちら）。 */
  courseName: string;
  /** 実効値（shifts の上書き ?? コース標準）。null なら行を省く。 */
  meetingPlace: string | null;
  meetingTime: string | null;
  plate: string | null;
  /** 「7/21(月)」等。呼び出し側で整形して渡す。 */
  dateLabel: string;
  /** org 設定のトグル。 */
  includeMeeting: boolean;
  includeVehicle: boolean;
  /** 確定後の変更を知らせる場合は true（件名に【変更】を付ける）。 */
  isChange?: boolean;
};

export type BuiltMessage = { title: string; body: string };

/**
 * 翌日アサイン通知の本文を組み立てる。
 * 値が無い項目の行は落とす（notification-flow §7「無ければ degrade」）。
 */
export function buildAssignmentMessage(input: AssignmentInput): BuiltMessage {
  const title = input.isChange
    ? `【変更】${input.dateLabel}の予定`
    : `${input.dateLabel}の予定`;

  const lines: string[] = [`コース: ${input.courseName}`];

  if (input.includeMeeting) {
    if (input.meetingTime) lines.push(`集合時刻: ${input.meetingTime}`);
    if (input.meetingPlace) lines.push(`集合場所: ${input.meetingPlace}`);
  }
  if (input.includeVehicle && input.plate) {
    lines.push(`車両: ${input.plate}`);
  }

  return { title, body: lines.join("\n") };
}

/** 休みの日の通知（org 設定で ON のときだけ使う）。 */
export function buildRestDayMessage(dateLabel: string): BuiltMessage {
  return {
    title: `${dateLabel}の予定`,
    body: "明日のシフトは入っていません。",
  };
}

/**
 * 冪等キー。「org×日×種別×membership」で1通に抑える（§3）。
 * 同じ日に同じ種別を二度送らないための鍵で、cron の重複起動を吸収する。
 */
export function buildDedupeKey(params: {
  orgId: string;
  date: string;
  kind: string;
  driverId: string;
}): string {
  return `${params.orgId}:${params.date}:${params.kind}:${params.driverId}`;
}
