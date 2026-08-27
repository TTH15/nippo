/**
 * コース単価の「契約上の真の基準」（税抜/税込どちらで決まっているか）に関する変換。
 * - exclusive: 保存値そのものが税抜（真の値）。税込は round(税抜 × (1+rate)) で導出する。
 * - inclusive: 契約原額を正本として別途保持し、税抜値はそこから導出する。
 *   数量を伴う集計では、単価を先に丸めず「契約単価 × 数量」の行合計を税抜化する。
 *
 * 金額（行合計・請求額）は円単位の整数だが、単価は小数を許す（例: 157.5円/個）。
 * 単価の換算には *UnitPrice 系を使い、円未満は行合計でだけ丸める。
 */
export type TaxBasis = "exclusive" | "inclusive";

const DEFAULT_RATE_PERCENT = 10;

/** 単価の小数桁。契約単価は 0.01円 単位まで保持する。 */
export const UNIT_PRICE_DECIMALS = 2;

/** 単価を小数第2位へ丸める（浮動小数の誤差を溜めない） */
export function roundUnitPrice(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** UNIT_PRICE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * 税抜金額を導出する（inclusive基準なら切り捨てで税抜化。exclusiveならそのまま）。
 * 割り算の浮動小数誤差（17,325 / 1.1 = 15749.999…）で1円切り下がるのを防ぐため、
 * 切り捨て前に 0.01 円単位へ丸める。
 */
export function exclusiveOf(raw: number, basis: TaxBasis, ratePercent = DEFAULT_RATE_PERCENT): number {
  if (basis !== "inclusive") return raw;
  return Math.floor(roundUnitPrice(raw / (1 + ratePercent / 100)));
}

/** 税込金額を導出する（exclusive基準なら四捨五入で税込化。inclusiveならそのまま）。 */
export function inclusiveOf(raw: number, basis: TaxBasis, ratePercent = DEFAULT_RATE_PERCENT): number {
  if (basis === "inclusive") return raw;
  return Math.round(raw * (1 + ratePercent / 100));
}

/**
 * 単価の税抜換算。金額と違い円未満を切り捨てず、小数第2位まで保持する。
 * 例: 税込173.25円/個 → 税抜157.5円/個。
 */
export function exclusiveUnitPriceOf(raw: number, basis: TaxBasis, ratePercent = DEFAULT_RATE_PERCENT): number {
  if (basis !== "inclusive") return roundUnitPrice(raw);
  return roundUnitPrice(raw / (1 + ratePercent / 100));
}

/** 単価の税込換算（小数第2位まで保持）。 */
export function inclusiveUnitPriceOf(raw: number, basis: TaxBasis, ratePercent = DEFAULT_RATE_PERCENT): number {
  if (basis === "inclusive") return roundUnitPrice(raw);
  return roundUnitPrice(raw * (1 + ratePercent / 100));
}

/**
 * 契約単価と数量から税抜の行合計を導出する。
 * 税込単価を1個ずつ税抜へ丸めると数量分の誤差が増幅するため、乗算後に一度だけ丸める。
 * 単価が小数（157.5円/個 など）でも、行合計は円単位の整数へ揃える。
 */
export function exclusiveContractTotal(
  contractUnitAmount: number,
  quantity: number,
  basis: TaxBasis,
  ratePercent = DEFAULT_RATE_PERCENT,
): number {
  const total = contractUnitAmount * quantity;
  if (basis === "inclusive") return Math.floor(roundUnitPrice(total / (1 + ratePercent / 100)));
  return Math.round(total);
}
