// ============================================================
// カレンダー追加リンクの生成（純粋関数）。
// 通知の「カレンダーに追加」ボタンから Google カレンダーの予定作成画面を開く。
//
// OAuth を伴う双方向同期ではなく、本人が1タップで自分のカレンダーへ入れるだけの片道リンク。
// 審査も同意フローも不要で、Google 以外を使う人はリンクを押さなければよい。
// ============================================================

/** 終了時刻が分からないときに置く既定の長さ（1日の稼働の目安）。 */
const DEFAULT_DURATION_HOURS = 8;

export type CalendarEventInput = {
  /** 予定のタイトル。 */
  title: string;
  /** YYYY-MM-DD（JST の暦日）。 */
  date: string;
  /** "08:00"。null なら終日予定にする。 */
  startTime: string | null;
  /** "17:00"。null なら開始から DEFAULT_DURATION_HOURS 後。 */
  endTime: string | null;
  location?: string | null;
  details?: string | null;
};

/** "YYYY-MM-DD" を年月日に分解する。不正な文字列は null。 */
function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** "HH:MM"（"HH:MM:SS" も可）を分に直す。不正なら null。 */
function parseMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 暦日に日数を足す（UTC で計算するのでタイムゾーンの影響を受けない）。 */
function addDays(date: string, days: number): string {
  const p = parseDate(date);
  if (!p) return date;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return t.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → "YYYYMMDD"。 */
function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

/** 分 → "HHMMSS"（24時を超える分は呼び出し側で日付に繰り上げる）。 */
function compactTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
}

/**
 * Google カレンダーの予定作成 URL を組み立てる。
 *
 * 時刻は ctz=Asia/Tokyo を付けて「その土地の時刻」として渡す（UTC 変換をしない）。
 * 端末のタイムゾーンが日本以外でも意図した時刻で入る。
 */
export function buildGoogleCalendarUrl(input: CalendarEventInput): string | null {
  if (!parseDate(input.date)) return null;

  const start = input.startTime ? parseMinutes(input.startTime) : null;

  let dates: string;
  if (start === null) {
    // 終日予定。Google の終日指定は終了日を「翌日」にする（終了日は排他的）
    dates = `${compactDate(input.date)}/${compactDate(addDays(input.date, 1))}`;
  } else {
    const parsedEnd = input.endTime ? parseMinutes(input.endTime) : null;
    // 終了が開始以前なら日をまたいだ勤務とみなす（22:00〜05:00 等）
    const rawEnd =
      parsedEnd === null
        ? start + DEFAULT_DURATION_HOURS * 60
        : parsedEnd <= start
          ? parsedEnd + 24 * 60
          : parsedEnd;
    const endDate = addDays(input.date, Math.floor(rawEnd / (24 * 60)));
    dates =
      `${compactDate(input.date)}T${compactTime(start)}` +
      `/${compactDate(endDate)}T${compactTime(rawEnd)}`;
  }

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates,
    ctz: "Asia/Tokyo",
  });
  if (input.location) params.set("location", input.location);
  if (input.details) params.set("details", input.details);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
