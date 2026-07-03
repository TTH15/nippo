// 請求書のページ分割（画面上で実際の印刷ページ境界を可視化するための計算）。
// DOM に依存しない純粋関数として切り出し、Vitest で単体テストできるようにする。
// 実際の DOM 計測（getBoundingClientRect）は PaginatedInvoiceSheet.tsx 側で行う。

export const MM_TO_PX = 96 / 25.4;

// A4 + .invoice-print-root の padding（globals.css の @media print と合わせる）。
export const PAGE_HEIGHT_PX = 297 * MM_TO_PX;
export const TOP_PAD_PX = 5 * MM_TO_PX;
export const BOTTOM_PAD_PX = 8 * MM_TO_PX;
// 計測誤差（サブピクセル丸め・折り返し差）を吸収する安全マージン。
// 実際の印刷より "早め" に改ページする分には安全（見切れの逆＝プレビューが過小評価することはない）。
const EPSILON_PX = 4;
export const PAGE_CONTENT_HEIGHT_PX = PAGE_HEIGHT_PX - TOP_PAD_PX - BOTTOM_PAD_PX - EPSILON_PX;

export type PageUnit = {
  /** 安定したユニット識別子（例: "main-row-3"）。 */
  id: string;
  /** 計測ルート基準の上端位置（px）。 */
  top: number;
  /** 要素の高さ（px）。 */
  height: number;
  /** true の場合、残り高さに関わらずこのユニットの直前で必ず改ページする。 */
  forceBreak: boolean;
  /**
   * true の場合、このユニットと直後のユニットを同じページに保つ（間で自然改ページしない）。
   * 直後のユニットが次ページへ送られる際は、このユニットも道連れで次ページへ送る
   * （例: 「お支払い」テーブルの最終セグメントを「振込先」ブロックと同じページに保つ）。
   */
  keepWithNext?: boolean;
};

/** 連続する keepWithNext のユニットをひとまとまりのグループにする。 */
function groupUnits(units: PageUnit[]): PageUnit[][] {
  const groups: PageUnit[][] = [];
  let current: PageUnit[] = [];
  for (const unit of units) {
    current.push(unit);
    if (!unit.keepWithNext) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * ユニット列を先頭から走査し、改ページが必要になるたびに onBreak(unit) を呼ぶ。
 * - forceBreak なユニットは（既にページ先頭でない限り）直前で改ページ
 * - 現在のページに収まらないユニットは（既にページ先頭でない限り）次ページへ送る
 * どちらの条件も「ページ先頭ちょうどにあるユニット」には適用しない
 * （空白ページや冗長な改ページを作らないため）。
 * keepWithNext で連結されたユニット群は、グループ単位でこの判定を行う
 * （グループの合計高さが収まらなければグループ全体を次ページへ送る）。
 */
function walkBreaks(units: PageUnit[], pageHeightPx: number, onBreak: (unit: PageUnit) => void): void {
  let pageStart = 0;
  for (const group of groupUnits(units)) {
    const first = group[0];
    const last = group[group.length - 1];
    const atPageStart = first.top <= pageStart;
    if (atPageStart) continue;
    const forcedOverflow = group.some((u) => u.forceBreak);
    const naturalOverflow = last.top + last.height - pageStart > pageHeightPx;
    if (forcedOverflow || naturalOverflow) {
      onBreak(first);
      pageStart = first.top;
    }
  }
}

/** ユニット列から各ページの開始 Y 座標（px, ルート基準）を返す。先頭は常に 0。 */
export function computePageBreaks(units: PageUnit[], pageHeightPx: number): number[] {
  const breaks = [0];
  walkBreaks(units, pageHeightPx, (unit) => breaks.push(unit.top));
  return breaks;
}

/** 改ページ直前に来るユニットの id 集合を返す。 */
export function computeBreakUnitIds(units: PageUnit[], pageHeightPx: number): Set<string> {
  const ids = new Set<string>();
  walkBreaks(units, pageHeightPx, (unit) => ids.add(unit.id));
  return ids;
}

/**
 * 各ユニットの id → ページ番号（0始まり）を返す。
 * 改ページ位置の判定（walkBreaks／computeBreakUnitIds と同じ1つのロジック）に対して
 * 素直にカウンタを1つ増やすだけなので、判定結果と番号付けが食い違うことはない。
 */
export function computePageIndices(units: PageUnit[], pageHeightPx: number): Map<string, number> {
  const breakIds = computeBreakUnitIds(units, pageHeightPx);
  const indices = new Map<string, number>();
  let page = 0;
  for (const unit of units) {
    if (breakIds.has(unit.id)) page += 1;
    indices.set(unit.id, page);
  }
  return indices;
}

/** DOM 計測結果から PageUnit 配列を組み立てる。root 自身との差分で top を出す（offsetTop は使わない）。 */
export function collectPageUnits(rootEl: HTMLElement): PageUnit[] {
  const rootRect = rootEl.getBoundingClientRect();
  const els = rootEl.querySelectorAll<HTMLElement>("[data-page-unit]");
  return Array.from(els).map((el, i) => {
    const rect = el.getBoundingClientRect();
    return {
      id: el.dataset.unitId ?? `unit-${i}`,
      top: rect.top - rootRect.top,
      height: rect.height,
      forceBreak: el.dataset.forceBreak === "true",
      keepWithNext: el.dataset.keepWithNext === "true",
    };
  });
}
