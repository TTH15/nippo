// 希望休（シフト提出）のドメインロジック（純粋・プラットフォーム非依存）。
// React state や DOM に依存せず、プレーンなデータ（requests / off マップ / periods）を
// 受け取り新しい値を返す。UI 側は setState ラッパとして薄く呼ぶだけにする。
import type { ShiftRequest, PeriodInfo } from "@/core/types";

/** 全休を表すキー（便ごとではなくその日まるごと休む）。 */
export const ALL = "ALL";

/** 編集中の希望休。date(YYYY-MM-DD) → { "ALL"(全休) | slotId } の集合。 */
export type OffMap = Map<string, Set<string>>;

/** サーバの希望休 requests を編集用の off マップへ変換する。 */
export function requestsToOffMap(requests: ShiftRequest[]): OffMap {
  const m: OffMap = new Map();
  requests.forEach((r) => {
    const key = r.slot_id ?? ALL;
    const s = m.get(r.request_date) ?? new Set<string>();
    s.add(key);
    m.set(r.request_date, s);
  });
  return m;
}

/** 指定日が属する提出期間（API値を信頼）。どの期間にも属さなければ null。 */
export function periodFor(
  periods: PeriodInfo[],
  dateStr: string,
): PeriodInfo | null {
  for (const p of periods) {
    if (dateStr >= p.startDate && dateStr <= p.endDate) return p;
  }
  return null;
}

/** 締切済み（変更不可）か。期間に属さなければ false（常に提出可）。 */
export function isLockedDate(periods: PeriodInfo[], dateStr: string): boolean {
  return periodFor(periods, dateStr)?.closed ?? false;
}

/** その日の休み集合を取得（無ければ空集合）。 */
export function dayOff(off: OffMap, dateStr: string): Set<string> {
  return off.get(dateStr) ?? new Set<string>();
}

/** その日が全休か。 */
export function isWholeDayOff(off: OffMap, dateStr: string): boolean {
  return dayOff(off, dateStr).has(ALL);
}

/** その日に何らかの休み希望があるか。 */
export function hasAnyOff(off: OffMap, dateStr: string): boolean {
  return dayOff(off, dateStr).size > 0;
}

/**
 * 全休/便キーをトグルする（全休と便は排他）。
 * 不変: 引数の off は変更せず、新しい OffMap を返す。
 */
export function toggleOffKey(off: OffMap, dateStr: string, key: string): OffMap {
  const next = new Map(off);
  const s = new Set(next.get(dateStr) ?? []);
  if (key === ALL) {
    if (s.has(ALL)) s.delete(ALL);
    else {
      s.clear();
      s.add(ALL);
    }
  } else {
    s.delete(ALL);
    if (s.has(key)) s.delete(key);
    else s.add(key);
  }
  if (s.size === 0) next.delete(dateStr);
  else next.set(dateStr, s);
  return next;
}

/** 編集中の off と サーバの requests に差分があるか。 */
export function hasOffChanges(requests: ShiftRequest[], off: OffMap): boolean {
  const serverKeys = new Set(
    requests.map((r) => `${r.request_date}#${r.slot_id ?? ALL}`),
  );
  const curKeys: string[] = [];
  off.forEach((set, d) => set.forEach((k) => curKeys.push(`${d}#${k}`)));
  if (curKeys.length !== serverKeys.size) return true;
  for (const k of curKeys) if (!serverKeys.has(k)) return true;
  return false;
}

/**
 * 送信用の offEntries を構築する。
 * 当月（monthStr 始まり）かつ未ロックの日のみを対象とし、全休は slotId=null に変換。
 */
export function buildOffEntries(
  off: OffMap,
  monthStr: string,
  periods: PeriodInfo[],
): { date: string; slotId: string | null }[] {
  const entries: { date: string; slotId: string | null }[] = [];
  off.forEach((set, d) => {
    if (!d.startsWith(monthStr) || isLockedDate(periods, d)) return;
    set.forEach((k) => entries.push({ date: d, slotId: k === ALL ? null : k }));
  });
  return entries;
}
