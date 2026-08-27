/**
 * 金額・個数入力を半角数字だけの文字列へ正規化する。
 * IME変換中の扱いは入力コンポーネント側で制御し、ここでは確定済み文字列だけを扱う。
 */
export function normalizeDigitText(value: string): string {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, "");
}

/**
 * 小数を許す金額入力（契約単価など）を正規化する。
 * 全角数字・全角ピリオドを半角へ寄せ、小数点は1つだけ・小数桁は maxFractionDigits まで残す。
 * 入力途中の "157." はそのまま返す（確定時に Number() で落ちる）。
 */
export function normalizeDecimalText(value: string, maxFractionDigits = 2): string {
  const halfWidth = value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[^0-9.]/g, "");
  const firstDot = halfWidth.indexOf(".");
  if (firstDot === -1) return halfWidth;
  if (maxFractionDigits <= 0) return halfWidth.slice(0, firstDot);
  const intPart = halfWidth.slice(0, firstDot);
  const fracPart = halfWidth.slice(firstDot + 1).replace(/\./g, "").slice(0, maxFractionDigits);
  return `${intPart}.${fracPart}`;
}
