// ============================================================
// 通知の文面生成（純粋関数）。
// 設計: docs/notification-flow.md §5「文面生成は純粋ロジック core/logic に置き
//       Web/RN/種別で再利用」。DB にも fetch にも触れない。
//
// 実効値の規則（roadmap A2）: shifts の上書き列が NULL ならコース標準を使う
//   実効値 = shifts.* ?? courses.*
//
// 予定は「1日分」を単位に扱う（DaySnapshot）。1人が同じ日に複数便を持てるため、
// 割当1件ではなく日ごとの束で比較・生成しないと、2便目が落ちたり
// 変更に気づけなかったりする。
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

/** 1本ぶんの割り当て（コース＋その日の実効値）。 */
export type AssignmentEntry = {
  /** 表示するコース名（略記があればそちら）。 */
  courseName: string;
  /** 実効値（shifts の上書き ?? コース標準）。null なら行を省く。 */
  meetingTime: string | null;
  meetingPlace: string | null;
  plate: string | null;
};

/** ある1日にドライバーへ伝えた／これから伝える予定。 */
export type DaySnapshot = {
  /** 便（slot）順。空配列 = その日は割り当てが無い。 */
  entries: AssignmentEntry[];
};

/** org 設定のトグル。載せない項目は比較にも使わない。 */
export type IncludeOptions = {
  includeMeeting: boolean;
  includeVehicle: boolean;
};

export type BuiltMessage = { title: string; body: string };

export const EMPTY_DAY: DaySnapshot = { entries: [] };

// ------------------------------------------------------------
// 本文の組み立て
// ------------------------------------------------------------

/** 「コース: Bコース（変更前: Aコース）」。変わっていなければ注釈を付けない。 */
function line(label: string, value: string | null, previous: string | null | undefined): string | null {
  if (!value) return null;
  if (!previous || previous === value) return `${label}: ${value}`;
  return `${label}: ${value}（変更前: ${previous}）`;
}

/** 1本ぶんの行。previous を渡すと差分に注釈が付く。 */
function entryLines(
  entry: AssignmentEntry,
  previous: AssignmentEntry | null,
  options: IncludeOptions,
): string[] {
  const lines = [line("コース", entry.courseName, previous?.courseName)];
  if (options.includeMeeting) {
    lines.push(line("集合時刻", entry.meetingTime, previous?.meetingTime));
    lines.push(line("集合場所", entry.meetingPlace, previous?.meetingPlace));
  }
  if (options.includeVehicle) {
    lines.push(line("車両", entry.plate, previous?.plate));
  }
  return lines.filter((l): l is string => l !== null);
}

/** 複数便は空行で区切って続けて書く。 */
function renderDay(
  snapshot: DaySnapshot,
  previous: DaySnapshot | null,
  options: IncludeOptions,
): string {
  // 便数が変わっている場合は index 同士の比較に意味が無いので、注釈を付けず現状だけ書く
  const comparable = previous !== null && previous.entries.length === snapshot.entries.length;
  return snapshot.entries
    .map((entry, i) => entryLines(entry, comparable ? previous.entries[i] : null, options).join("\n"))
    .join("\n\n");
}

/**
 * 翌日アサイン通知の本文を組み立てる。
 * 値が無い項目の行は落とす（notification-flow §7「無ければ degrade」）。
 */
export function buildDayMessage(input: {
  dateLabel: string;
  snapshot: DaySnapshot;
  includeMeeting: boolean;
  includeVehicle: boolean;
}): BuiltMessage {
  return {
    title: `${input.dateLabel}の予定`,
    body: renderDay(input.snapshot, null, input),
  };
}

/** 休みの日の通知（org 設定で ON のときだけ使う）。 */
export function buildRestDayMessage(dateLabel: string): BuiltMessage {
  return {
    title: `${dateLabel}の予定`,
    body: "明日のシフトは入っていません。",
  };
}

// ------------------------------------------------------------
// 変更通知（notification-flow §2「【変更】」）
//
// ★イベント駆動（変更が起きた瞬間に送る）にはしない。
//   運営はセル操作で何度も割当を変え、確認のために画面を触り直す。
//   「変更が起きた回数」を数えると、その途中経過が全部ドライバーに飛んでしまう。
//
//   代わりに「最後にドライバーへ伝えた内容（スナップショット）」を通知レコードに残し、
//   現在のシフトとの差分を都度計算する。状態の比較なので、
//     - 何度触り直しても差分は1件に畳まれる
//     - 元に戻せば差分は消える（＝通知するものが無くなる）
//     - 画面を再読み込みしても結果が変わらない
//   送信は運営の明示操作で行う（この層は「何を送るか」だけを決める純粋関数）。
// ------------------------------------------------------------

export type AssignmentChangeKind =
  /** 休み → 出番。 */
  | "added"
  /** 出番 → 休み。 */
  | "canceled"
  /** 中身が変わった。 */
  | "changed";

export type AssignmentDiff = {
  kind: AssignmentChangeKind;
  /** 変わった項目のラベル。kind が changed のときだけ埋まる。 */
  fields: string[];
};

/** 1本ぶんの差分項目。載せていない項目は数えない。 */
function changedFields(
  before: AssignmentEntry,
  after: AssignmentEntry,
  options: IncludeOptions,
): string[] {
  const fields: string[] = [];
  if (before.courseName !== after.courseName) fields.push("コース");
  if (options.includeMeeting) {
    if ((before.meetingTime ?? null) !== (after.meetingTime ?? null)) fields.push("集合時刻");
    if ((before.meetingPlace ?? null) !== (after.meetingPlace ?? null)) fields.push("集合場所");
  }
  if (options.includeVehicle) {
    if ((before.plate ?? null) !== (after.plate ?? null)) fields.push("車両");
  }
  return fields;
}

/**
 * 「伝えた内容」と「現在の内容」を比べて、通知すべき差分を返す。通知不要なら null。
 *
 * org 設定で通知に載せていない項目（集合・車両）の変化は差分に数えない。
 * 載せていない＝ドライバーは元の値を知らないので、変わったと伝えても意味がないため。
 */
export function diffDay(
  before: DaySnapshot,
  after: DaySnapshot,
  options: IncludeOptions,
): AssignmentDiff | null {
  if (before.entries.length === 0 && after.entries.length === 0) return null;
  if (before.entries.length === 0) return { kind: "added", fields: [] };
  if (after.entries.length === 0) return { kind: "canceled", fields: [] };
  // 便数そのものが変わった（1便→2便 等）。個別項目より先に伝えるべき変化
  if (before.entries.length !== after.entries.length) {
    return { kind: "changed", fields: ["割り当て"] };
  }

  const fields: string[] = [];
  for (let i = 0; i < after.entries.length; i++) {
    for (const field of changedFields(before.entries[i], after.entries[i], options)) {
      if (!fields.includes(field)) fields.push(field);
    }
  }
  return fields.length > 0 ? { kind: "changed", fields } : null;
}

/**
 * 変更通知の文面。差分のある行に「（変更前: …）」を添え、
 * 変わっていない行もそのまま載せる（その日の予定として単体で読めるようにする）。
 */
export function buildChangeMessage(input: {
  dateLabel: string;
  diff: AssignmentDiff;
  before: DaySnapshot;
  after: DaySnapshot;
  includeMeeting: boolean;
  includeVehicle: boolean;
}): BuiltMessage {
  const prefix =
    input.diff.kind === "added" ? "【追加】" : input.diff.kind === "canceled" ? "【取消】" : "【変更】";
  const title = `${prefix}${input.dateLabel}の予定`;

  if (input.diff.kind === "canceled") {
    const lines = ["この日の割り当ては取り消されました。"];
    const names = input.before.entries.map((e) => e.courseName).filter(Boolean);
    if (names.length > 0) lines.push(`変更前のコース: ${names.join("・")}`);
    return { title, body: lines.join("\n") };
  }

  // 追加は「変更前」が無いので、通常のアサイン通知と同じ体裁にする
  const previous = input.diff.kind === "added" ? null : input.before;
  return { title, body: renderDay(input.after, previous, input) };
}

// ------------------------------------------------------------
// 冪等キー
// ------------------------------------------------------------

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

/**
 * 変更通知の冪等キー。同じ日の変更は複数回起こりうるので通し番号（seq）を含める。
 *
 * seq = その driver × 日付で既に送った変更通知の件数。
 * 二重クリックや同時送信は同じ seq を算出して 1 通に潰れ、
 * 送信後に改めて起きた変更は seq が進むので別の通知として送れる。
 */
export function buildChangeDedupeKey(params: {
  orgId: string;
  date: string;
  driverId: string;
  seq: number;
}): string {
  return `${params.orgId}:${params.date}:change:${params.driverId}:${params.seq}`;
}
