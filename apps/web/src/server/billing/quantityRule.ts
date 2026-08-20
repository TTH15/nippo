export type QuantityRule =
  | { kind: "actual" }
  | { kind: "minimum"; minimum: number; scope: "report" };

export const ACTUAL_QUANTITY_RULE: QuantityRule = { kind: "actual" };

export function normalizeQuantityRule(value: unknown): QuantityRule {
  if (!value || typeof value !== "object") return ACTUAL_QUANTITY_RULE;
  const rule = value as Record<string, unknown>;
  if (rule.kind === "minimum") {
    const minimum = Math.max(0, Math.trunc(Number(rule.minimum) || 0));
    return minimum > 0 ? { kind: "minimum", minimum, scope: "report" } : ACTUAL_QUANTITY_RULE;
  }
  return ACTUAL_QUANTITY_RULE;
}

/** 現段階のルールは日報（= 1コース・1便・1稼働）単位で数量を補正する。 */
export function applyQuantityRule(actualQuantity: number, value: unknown): number {
  const actual = Math.max(0, Number(actualQuantity) || 0);
  const rule = normalizeQuantityRule(value);
  return rule.kind === "minimum" ? Math.max(actual, rule.minimum) : actual;
}
