/**
 * 金額・個数入力を半角数字だけの文字列へ正規化する。
 * IME変換中の扱いは入力コンポーネント側で制御し、ここでは確定済み文字列だけを扱う。
 */
export function normalizeDigitText(value: string): string {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, "");
}
