// ============================================================
// 地図の検索窓で「車両・ドライバー」を引くための照合（純粋ロジック）。
//
// 監査（2026-09-08 P2-6）で、検索が Mapbox の住所・施設だけで、車番やドライバー名から
// 車を探せないことを確定させた。運営が地図で最初にやることは「あの車どこ？」なので、
// 同じ窓の上段でローカルの車両を返す。位置がまだ無い車も候補に出す（そのまま置ける）。
//
// 現場の打ち方に合わせる:
//   - 「1000」「10-00」「１０００」どれでも 10-00 に当たる（区切りと全角を無視）
//   - 「わ」「京都」「ハイゼット」「島本」でも引ける
//   - 4桁の一致を最優先。次に前方一致、最後に部分一致
// ============================================================

export type VehicleSearchTarget = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  /** その車に乗っている（乗っていた）人。位置情報の driverName */
  driverName?: string | null;
  /** 位置が無い車は「地図をクリックして置く」に入る */
  hasPosition?: boolean;
};

/** 全角の英数字を半角にし、空白・ハイフン類を落として小文字にそろえる */
export function normalizeQuery(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　ー\-‐-―−]/g, "")
    .toLowerCase();
}

/** 数字だけを取り出す（"10-00" → "1000"） */
const digitsOf = (value: string | null | undefined): string => normalizeQuery(value).replace(/\D/g, "");

/**
 * 一致の強さ。小さいほど上に出す。
 *   0: 4桁が完全一致   1: 4桁の前方一致   2: 4桁の部分一致
 *   3: 文字（地名・かな・車種・人名）の前方一致   4: 同・部分一致
 * 当たらなければ null。
 */
export function matchScore(target: VehicleSearchTarget, query: string): number | null {
  const q = normalizeQuery(query);
  if (!q) return null;
  const qDigits = q.replace(/\D/g, "");

  if (qDigits) {
    const numeric = digitsOf(target.number_numeric);
    if (numeric) {
      if (numeric === qDigits) return 0;
      if (numeric.startsWith(qDigits)) return 1;
      if (numeric.includes(qDigits)) return 2;
    }
    // 分類番号（480 等）は完全一致のときだけ。前方一致にすると「48」で
    // 480 の車が全部並んで、車番で絞れなくなる（2026-09-08 プレビューで確認）
    const cls = digitsOf(target.number_class);
    if (cls && cls === qDigits) return 2;
  }

  const words = [
    target.number_prefix,
    target.number_hiragana,
    target.manufacturer,
    target.brand,
    target.driverName,
  ]
    .map(normalizeQuery)
    .filter(Boolean);

  if (words.some((w) => w.startsWith(q))) return 3;
  if (words.some((w) => w.includes(q))) return 4;
  return null;
}

/** 一致した車両を強い順に返す。同じ強さなら位置がある車を先に出す（すぐ飛べるため） */
export function matchVehicles<T extends VehicleSearchTarget>(
  vehicles: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of vehicles) {
    const score = matchScore(item, query);
    if (score != null) scored.push({ item, score });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aPos = a.item.hasPosition ? 0 : 1;
    const bPos = b.item.hasPosition ? 0 : 1;
    if (aPos !== bPos) return aPos - bPos;
    return digitsOf(a.item.number_numeric).localeCompare(digitsOf(b.item.number_numeric));
  });
  return scored.slice(0, limit).map((s) => s.item);
}
