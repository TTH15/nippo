/** 売上・原価の組合せで利益が漏れないよう、ブラウザとサーバーで同じ実効権限を使う。 */
export function restrictFinancialCapabilities<T extends string>(caps: Set<T>): Set<T> {
  const has = (cap: string) => caps.has(cap as T);
  const remove = (cap: string) => caps.delete(cap as T);
  // 請求・取引先の金額は売上と支払を含む。
  if (!has("can_view_sales") || !has("can_view_profit")) {
    remove("can_view_billing"); remove("can_manage_billing");
  }
  if (has("can_view_sales") && !has("can_view_profit")) {
    remove("can_view_rewards"); remove("can_manage_rewards"); remove("can_view_vehicle_cost");
  }
  return caps;
}
