// ============================================================
// シフト表エクスポートの「どこを出すか」。Excel の選択に寄せる。
//
//   出力は「どの日付 × どの人」の表なので、選択も **列の集合 × 行の集合** で持つ。
//   矩形ドラッグは「連続した列と行を選ぶ」操作として、この形にそのまま落ちる。
//   飛び飛びの選択（Cmd+クリックで行を足す）も同じ形で表せる。
//
//   | 操作                         | 結果                                   |
//   |------------------------------|----------------------------------------|
//   | セルをドラッグ / クリック    | その矩形（日付の範囲 × 人の範囲）      |
//   | Shift + セルクリック         | 起点から今のセルまで矩形を伸ばす       |
//   | 名前をクリック               | その行全体                             |
//   | Shift + 名前クリック         | 起点の行から今の行まで                 |
//   | Cmd/Ctrl + 名前クリック      | その行を足す／外す                     |
//   | 名前の列をドラッグ           | 連続した行                             |
//   | 日付の見出しも同じ（列）     |                                        |
//   | 左上（「ドライバー」）       | 全選択                                 |
// ============================================================

export type ExportCell = { dayIndex: number; rowIndex: number };

export type ShiftExportSelection = {
  /** 出す日付の添字（昇順・重複なし）。null = 全部 */
  days: number[] | null;
  /** 出す人の添字（昇順・重複なし）。null = 全部 */
  rows: number[] | null;
  /** Shift+クリックの基準。直前に「選び始めた」場所 */
  anchor: ExportCell | null;
};

export const selectAll: ShiftExportSelection = { days: null, rows: null, anchor: null };

const range = (a: number, b: number) =>
  Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i);

/** 全部そろっていれば null（＝全部）へ畳む。状態を1つに保ち、「全部出す」の判定も単純になる。 */
const normalize = (indexes: number[], count: number): number[] | null => {
  const unique = [...new Set(indexes)].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
  return unique.length === count ? null : unique;
};

export const isDayIncluded = (s: ShiftExportSelection, dayIndex: number) =>
  s.days === null || s.days.includes(dayIndex);
export const isRowIncluded = (s: ShiftExportSelection, rowIndex: number) =>
  s.rows === null || s.rows.includes(rowIndex);
/** セルが出力に入るか。列と行の両方が選ばれているときだけ。 */
export const isCellIncluded = (s: ShiftExportSelection, dayIndex: number, rowIndex: number) =>
  isDayIncluded(s, dayIndex) && isRowIncluded(s, rowIndex);

const resolved = (indexes: number[] | null, count: number) =>
  indexes ?? Array.from({ length: count }, (_, i) => i);

/** セルの矩形を選ぶ（ドラッグ中・ドラッグ確定・Shift+クリック共通）。 */
export function selectCellRect(
  start: ExportCell,
  end: ExportCell,
  dayCount: number,
  rowCount: number,
): ShiftExportSelection {
  return {
    days: normalize(range(start.dayIndex, end.dayIndex), dayCount),
    rows: normalize(range(start.rowIndex, end.rowIndex), rowCount),
    anchor: start,
  };
}

/** Shift+クリック。起点が無ければ単独クリックと同じ。 */
export function extendToCell(
  s: ShiftExportSelection,
  cell: ExportCell,
  dayCount: number,
  rowCount: number,
): ShiftExportSelection {
  return selectCellRect(s.anchor ?? cell, cell, dayCount, rowCount);
}

/** 名前クリック＝その行全体。日付は全部に戻す（Excel の行ヘッダと同じ）。 */
export function selectRows(
  rowIndexes: number[],
  dayCount: number,
  rowCount: number,
  anchorRow: number,
): ShiftExportSelection {
  return { days: null, rows: normalize(rowIndexes, rowCount), anchor: { dayIndex: 0, rowIndex: anchorRow } };
}

/** Shift+名前クリック＝起点の行から今の行まで。 */
export function extendRows(
  s: ShiftExportSelection,
  rowIndex: number,
  dayCount: number,
  rowCount: number,
): ShiftExportSelection {
  const from = s.anchor?.rowIndex ?? rowIndex;
  return { ...s, rows: normalize(range(from, rowIndex), rowCount), anchor: { dayIndex: 0, rowIndex: from } };
}

/** Cmd/Ctrl+名前クリック＝その行を足す／外す。最後の1行は外さない（空の出力を作らない）。 */
export function toggleRow(s: ShiftExportSelection, rowIndex: number, rowCount: number): ShiftExportSelection {
  const current = resolved(s.rows, rowCount);
  const next = current.includes(rowIndex) ? current.filter((i) => i !== rowIndex) : [...current, rowIndex];
  if (next.length === 0) return s;
  return { ...s, rows: normalize(next, rowCount), anchor: { dayIndex: s.anchor?.dayIndex ?? 0, rowIndex } };
}

/** 日付の見出しクリック＝その列全体。 */
export function selectDays(
  dayIndexes: number[],
  dayCount: number,
  rowCount: number,
  anchorDay: number,
): ShiftExportSelection {
  return { days: normalize(dayIndexes, dayCount), rows: null, anchor: { dayIndex: anchorDay, rowIndex: 0 } };
}

export function extendDays(
  s: ShiftExportSelection,
  dayIndex: number,
  dayCount: number,
): ShiftExportSelection {
  const from = s.anchor?.dayIndex ?? dayIndex;
  return { ...s, days: normalize(range(from, dayIndex), dayCount), anchor: { dayIndex: from, rowIndex: 0 } };
}

export function toggleDay(s: ShiftExportSelection, dayIndex: number, dayCount: number): ShiftExportSelection {
  const current = resolved(s.days, dayCount);
  const next = current.includes(dayIndex) ? current.filter((i) => i !== dayIndex) : [...current, dayIndex];
  if (next.length === 0) return s;
  return { ...s, days: normalize(next, dayCount), anchor: { dayIndex, rowIndex: s.anchor?.rowIndex ?? 0 } };
}

/** 出力に残る添字。 */
export function includedIndexes(
  s: ShiftExportSelection,
  dayCount: number,
  rowCount: number,
): { days: number[]; rows: number[] } {
  return { days: resolved(s.days, dayCount), rows: resolved(s.rows, rowCount) };
}

export const isSelectionEmpty = (s: ShiftExportSelection, dayCount: number, rowCount: number) => {
  const { days, rows } = includedIndexes(s, dayCount, rowCount);
  return days.length === 0 || rows.length === 0;
};

export const isSelectAll = (s: ShiftExportSelection) => s.days === null && s.rows === null;

/**
 * セルの選択枠。隣が選ばれていない辺にだけ線を引く。
 * 飛び飛びの選択でも、まとまりごとに Excel と同じ枠になる。
 */
export function cellEdges(
  s: ShiftExportSelection,
  dayIndex: number,
  rowIndex: number,
  dayCount: number,
  rowCount: number,
): { top: boolean; bottom: boolean; left: boolean; right: boolean } | null {
  if (!isCellIncluded(s, dayIndex, rowIndex)) return null;
  // ★表の外は「選ばれていない」。days/rows が null（＝全部）のとき、
  //   範囲外の添字まで選択済みと見なすと表の縁に枠が出ない。
  const inside = (d: number, r: number) =>
    d >= 0 && d < dayCount && r >= 0 && r < rowCount && isCellIncluded(s, d, r);
  return {
    top: !inside(dayIndex, rowIndex - 1),
    bottom: !inside(dayIndex, rowIndex + 1),
    left: !inside(dayIndex - 1, rowIndex),
    right: !inside(dayIndex + 1, rowIndex),
  };
}

/** 選択の要約（「9/16〜9/20（5日）· 4人」）。飛び飛びなら日数・人数だけ伝える。 */
export function describeSelection(
  s: ShiftExportSelection,
  dates: readonly string[],
  formatDate: (iso: string) => string,
  rowCount: number,
): string {
  const { days, rows } = includedIndexes(s, dates.length, rowCount);
  if (days.length === 0 || rows.length === 0) return "選んだ範囲に出せるものがありません";
  const contiguous = days[days.length - 1] - days[0] === days.length - 1;
  const span =
    days.length === 1
      ? formatDate(dates[days[0]])
      : contiguous
        ? `${formatDate(dates[days[0]])}〜${formatDate(dates[days[days.length - 1]])}`
        : `${formatDate(dates[days[0]])} ほか`;
  return `${span}（${days.length}日） · ${rows.length}人`;
}
