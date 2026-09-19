// ============================================================
// 画面を画像にするときの倍率。
//
//   「横長でも縦長でも1枚に収めたい」ため、枚数で割らずに1枚へ描く。
//   そのぶん大きくなるので、ブラウザのキャンバス制限に当たらない倍率を選ぶ。
//     ・1辺の上限: 実装依存（Safari が最も厳しい）。余裕をみて 12000px。
//     ・面積の上限: メモリ（RGBA で 1px=4byte）。30M px ≒ 120MB を上限にする。
//   どちらにも当たらなければ、文字がなめらかになるよう倍率を上げる。
// ============================================================

export const MAX_IMAGE_SIDE = 12_000;
export const MAX_IMAGE_AREA = 30_000_000;

/**
 * 画像の倍率を決める。
 * @param width  CSS ピクセルでの幅
 * @param height CSS ピクセルでの高さ
 * @param preferred 収まるなら使いたい倍率（既定3＝高精細）
 */
export function captureScale(width: number, height: number, preferred = 3): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const bySide = Math.min(MAX_IMAGE_SIDE / width, MAX_IMAGE_SIDE / height);
  const byArea = Math.sqrt(MAX_IMAGE_AREA / (width * height));
  // 上限に当たらない範囲で、できるだけ preferred に近づける。
  // CSS ピクセル等倍（1）より下げるのは、等倍でも上限を超える場合だけ。
  return Math.min(preferred, bySide, byArea);
}
