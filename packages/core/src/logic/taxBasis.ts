/**
 * コース単価の「契約上の真の基準」（税抜/税込どちらで決まっているか）に関する変換。
 * - exclusive: 保存値そのものが税抜（真の値）。税込は round(税抜 × (1+rate)) で導出する。
 * - inclusive: 保存値は税抜換算済みの導出値。契約上の真の値（税込のキリの良い数字）は
 *   保存時点で失われているため、税込側へ逆算しても厳密には一致しない場合がある
 *   （端数はextraOutsourcing等で調整する運用を前提とする）。
 */
export type TaxBasis = "exclusive" | "inclusive";

const DEFAULT_RATE_PERCENT = 10;

/** 税抜金額を導出する（inclusive基準なら切り捨てで税抜化。exclusiveならそのまま）。 */
export function exclusiveOf(raw: number, basis: TaxBasis, ratePercent = DEFAULT_RATE_PERCENT): number {
  if (basis !== "inclusive") return raw;
  return Math.floor(raw / (1 + ratePercent / 100));
}

/** 税込金額を導出する（exclusive基準なら四捨五入で税込化。inclusiveならそのまま）。 */
export function inclusiveOf(raw: number, basis: TaxBasis, ratePercent = DEFAULT_RATE_PERCENT): number {
  if (basis === "inclusive") return raw;
  return Math.round(raw * (1 + ratePercent / 100));
}
