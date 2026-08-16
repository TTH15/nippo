// ============================================================
// 配達個数の集計ロジック（純粋関数）。
//
// 日報の報告項目（unit_fields）は「完了個数」「持戻個数」「持出個数」等が
// 会社ごとに自由に定義される。集計側で「どれが配達できた数か」を知る必要があるが、
// **DB には項目の役割を表す列が無い**（is_billable は課金に使うかどうかで、
// 役割とは別物 — Amazon のように日当課金の会社は完了個数でも is_billable=false）。
//
// そこでキー名・ラベルから役割を推定する。分類できないものは "other" にして
// 合計や率の計算から外す（間違った数字を出すより出さない）。
//   将来 unit_fields に role 列を足せば、この推定は捨てて置き換えられる。
// ============================================================

export type CountRole = "completed" | "returned" | "other";

/**
 * 報告項目の役割を推定する。
 * 判定は「持戻 → 完了」の順（"持戻個数" は "個数" を含むため、
 * 完了の判定を先にすると取り違える）。
 */
export function classifyCountField(field: { key: string; label?: string | null }): CountRole {
  const key = field.key.toLowerCase();
  const label = field.label ?? "";

  if (key.includes("return") || label.includes("持戻") || label.includes("持ち戻")) {
    return "returned";
  }
  if (key.includes("completed") || key.includes("complete") || label.includes("完了")) {
    return "completed";
  }
  return "other";
}

export type FieldTotals = {
  completed: number;
  returned: number;
  other: number;
};

export const EMPTY_TOTALS: FieldTotals = { completed: 0, returned: 0, other: 0 };

/** 役割ごとに個数を足し込む。 */
export function accumulate(
  totals: FieldTotals,
  role: CountRole,
  value: number,
): FieldTotals {
  return { ...totals, [role]: totals[role] + value };
}

/**
 * 持戻率（完了＋持戻 に対する持戻の割合・%）。
 * 母数が 0 のときは null（「0%」と出すと実績があるように見えるため）。
 */
export function returnRate(totals: Pick<FieldTotals, "completed" | "returned">): number | null {
  const handled = totals.completed + totals.returned;
  if (handled <= 0) return null;
  return (totals.returned / handled) * 100;
}

/** 1人あたりの個数。人数 0 なら null。 */
export function perDriver(total: number, driverCount: number): number | null {
  if (driverCount <= 0) return null;
  return total / driverCount;
}
