import TextRecognition, {
  TextRecognitionScript,
  type TextRecognitionResult,
} from "@react-native-ml-kit/text-recognition";

// オドメーター画像（ローカル uri）をオンデバイス OCR して走行距離（整数km）を推定する。
// 画像は端末から出ない。読み取れなければ null（呼び出し側で手入力フォールバック）。

/**
 * OCR 生テキストからオドメーター値を推定する純関数。
 * メーター部には総走行距離(5〜6桁)・トリップ・時計・燃料計など複数の数字が写りうるため、
 * 「4〜7桁の整数列」を候補にし、最長（同長なら最大値）を採用する。
 */
export function parseOdometerFromOcr(text: string): number | null {
  const cleaned = (text ?? "").replace(/[,，\s]/g, "");
  const seqs = cleaned.match(/\d{3,7}/g) ?? [];
  if (seqs.length === 0) return null;
  const preferred = seqs.filter((s) => s.length >= 4 && s.length <= 7);
  const pool = preferred.length > 0 ? preferred : seqs;
  pool.sort((a, b) => b.length - a.length || Number(b) - Number(a));
  const n = Number(pool[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 画像中央の横帯（ROI）に入る行だけを対象に走行距離を推定する。
 * メーター周辺の速度計・タコ・ギア表示などのノイズを位置で除外する。
 * @param bandTop/bandBottom 相対位置(0..1)。既定は中央 36%〜64%。
 */
export function parseOdometerInBand(
  result: TextRecognitionResult,
  picHeight: number,
  bandTop = 0.36,
  bandBottom = 0.64,
): number | null {
  if (!picHeight || picHeight <= 0) return parseOdometerFromOcr(result.text ?? "");
  const texts: string[] = [];
  for (const block of result.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const f = line.frame;
      if (!f) continue;
      const cy = (f.top + f.height / 2) / picHeight;
      if (cy >= bandTop && cy <= bandBottom) texts.push(line.text);
    }
  }
  const banded = texts.join(" ");
  // 帯内に数字が無ければ全体テキストにフォールバック
  return parseOdometerFromOcr(banded) ?? parseOdometerFromOcr(result.text ?? "");
}

/** 単発の静止画 OCR（帯フィルタなし）。 */
export async function recognizeOdometer(uri: string): Promise<number | null> {
  const result = await TextRecognition.recognize(uri, TextRecognitionScript.LATIN);
  return parseOdometerFromOcr(result.text ?? "");
}

/** ROI（中央横帯）対象の OCR。撮影画像の高さを渡す。 */
export async function recognizeOdometerBand(uri: string, picHeight: number): Promise<number | null> {
  const result = await TextRecognition.recognize(uri, TextRecognitionScript.LATIN);
  return parseOdometerInBand(result, picHeight);
}
