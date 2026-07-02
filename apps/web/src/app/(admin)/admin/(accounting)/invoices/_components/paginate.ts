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
};

/**
 * ユニット列を先頭から走査し、改ページが必要になるたびに onBreak(unit) を呼ぶ。
 * - forceBreak なユニットは（既にページ先頭でない限り）直前で改ページ
 * - 現在のページに収まらないユニットは（既にページ先頭でない限り）次ページへ送る
 * どちらの条件も「ページ先頭ちょうどにあるユニット」には適用しない
 * （空白ページや冗長な改ページを作らないため）。
 */
function walkBreaks(units: PageUnit[], pageHeightPx: number, onBreak: (unit: PageUnit) => void): void {
  let pageStart = 0;
  for (const unit of units) {
    const atPageStart = unit.top <= pageStart;
    if (atPageStart) continue;
    const forcedOverflow = unit.forceBreak;
    const naturalOverflow = unit.top + unit.height - pageStart > pageHeightPx;
    if (forcedOverflow || naturalOverflow) {
      onBreak(unit);
      pageStart = unit.top;
    }
  }
}

/** ユニット列から各ページの開始 Y 座標（px, ルート基準）を返す。先頭は常に 0。 */
export function computePageBreaks(units: PageUnit[], pageHeightPx: number): number[] {
  const breaks = [0];
  walkBreaks(units, pageHeightPx, (unit) => breaks.push(unit.top));
  return breaks;
}

/** 改ページ直前に来るユニットの id 集合を返す（画面上の継ぎ目バンド描画に使う）。 */
export function computeBreakUnitIds(units: PageUnit[], pageHeightPx: number): Set<string> {
  const ids = new Set<string>();
  walkBreaks(units, pageHeightPx, (unit) => ids.add(unit.id));
  return ids;
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
    };
  });
}
