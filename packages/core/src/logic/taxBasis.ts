/**
 * コース単価の「契約上の真の基準」（税抜/税込どちらで決まっているか）に関する変換。
 * - exclusive: 保存値そのものが税抜（真の値）。税込は round(税抜 × (1+rate)) で導出する。
 * - inclusive: 契約原額を正本として別途保持し、税抜値はそこから導出する。
 *   数量を伴う集計では、単価を先に丸めず「契約単価 × 数量」の行合計を税抜化する。
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

/**
 * 契約単価と数量から税抜の行合計を導出する。
 * 税込単価を1個ずつ税抜へ丸めると数量分の誤差が増幅するため、乗算後に一度だけ丸める。
 */
export function exclusiveContractTotal(
  contractUnitAmount: number,
  quantity: number,
  basis: TaxBasis,
  ratePercent = DEFAULT_RATE_PERCENT,
): number {
  return exclusiveOf(contractUnitAmount * quantity, basis, ratePercent);
}
