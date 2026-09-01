export const DISPATCH_IMAGE_MAX_ROWS_PER_PAGE = 12;

export type DispatchImagePage = { start: number; end: number };

/**
 * 日別配車画像の改ページ位置を決める。
 *
 * 1枚の上限を守りつつ、契約区分・コースなど同じまとまりの途中を避ける。
 * ただし、まとまりを守ると次ページが1行だけになる場合は、読みやすさを優先して
 * 前のまとまりを均等に分ける。
 */
export function planDispatchImagePages(
  groupKeys: string[],
  maxRows = DISPATCH_IMAGE_MAX_ROWS_PER_PAGE,
): DispatchImagePage[] {
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error("maxRows must be a positive integer");
  const rowCount = groupKeys.length;
  if (rowCount === 0) return [{ start: 0, end: 0 }];

  const pageCount = Math.ceil(rowCount / maxRows);
  if (pageCount === 1) return [{ start: 0, end: rowCount }];
  const targetSize = rowCount / pageCount;
  const memo = new Map<string, { cost: number; pages: DispatchImagePage[] } | null>();

  const solve = (start: number, pagesLeft: number): { cost: number; pages: DispatchImagePage[] } | null => {
    const key = `${start}:${pagesLeft}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    if (pagesLeft === 1) {
      const size = rowCount - start;
      const result = size >= 1 && size <= maxRows
        ? { cost: pageCost(size, targetSize), pages: [{ start, end: rowCount }] }
        : null;
      memo.set(key, result);
      return result;
    }

    const minEnd = Math.max(start + 1, rowCount - maxRows * (pagesLeft - 1));
    const maxEnd = Math.min(start + maxRows, rowCount - (pagesLeft - 1));
    let best: { cost: number; pages: DispatchImagePage[] } | null = null;
    for (let end = minEnd; end <= maxEnd; end += 1) {
      const rest = solve(end, pagesLeft - 1);
      if (!rest) continue;
      const splitsGroup = groupKeys[end - 1] === groupKeys[end];
      const cost = pageCost(end - start, targetSize) + (splitsGroup ? 400 : 0) + rest.cost;
      if (!best || cost < best.cost) best = { cost, pages: [{ start, end }, ...rest.pages] };
    }
    memo.set(key, best);
    return best;
  };

  return solve(0, pageCount)?.pages ?? [{ start: 0, end: rowCount }];
}

function pageCost(size: number, targetSize: number): number {
  const balanceCost = Math.pow(size - targetSize, 2) * 4;
  // 2行は自然な区切りなら許容するが、1行だけのページは強く避ける。
  const shortPageCost = size === 1 ? 1_000 : size === 2 ? 80 : 0;
  return balanceCost + shortPageCost;
}
