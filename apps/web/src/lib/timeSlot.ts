// 時間帯（時刻範囲 or 便名）の表示・重なり判定の共通ユーティリティ（client/server両用・ランタイム依存なし）。
//   表示ルール: 時刻があれば時刻、無ければ便名。
//   重なり: null=終日（何にでも重なる）。時刻ありは区間交差。時刻なし便名は同一idのみ重なる。

export type TimeSlotInfo = {
  id: string;
  name: string;
  startTime: string | null; // "HH:MM" or "HH:MM:SS"
  endTime: string | null;
};

/** "HH:MM:SS" → "HH:MM"。 */
const hhmm = (t: string): string => (t.length >= 5 ? t.slice(0, 5) : t);

/** 時間帯の表示文字列（時刻優先・無ければ便名）。 */
export function slotDisplayLabel(s: { name: string; startTime: string | null; endTime: string | null }): string {
  if (s.startTime && s.endTime) return `${hhmm(s.startTime)}-${hhmm(s.endTime)}`;
  if (s.startTime) return `${hhmm(s.startTime)}〜`;
  return s.name;
}

type OverlapSlot = { id: string; startTime: string | null; endTime: string | null } | null;

/** 2つの時間帯が重なるか。null=終日（何にでも重なる）。 */
export function slotsOverlap(a: OverlapSlot, b: OverlapSlot): boolean {
  if (!a || !b) return true; // 終日はすべてと重なる
  if (a.startTime && a.endTime && b.startTime && b.endTime) {
    // 区間交差 [start, end)（文字列比較で可。"HH:MM(:SS)" は辞書順＝時刻順）
    return a.startTime < b.endTime && b.startTime < a.endTime;
  }
  // どちらかが時刻なし（便名のみ）→ 同一時間帯のみ重なる
  return a.id === b.id;
}
