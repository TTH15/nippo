import { restrictFinancialCapabilities } from "@/lib/financialCapabilities";

/** 実APIと同じ金額境界を隔離fixtureにも適用する。 */
export function previewFinancialError(path: string, method: string, granted: readonly string[]): Error | null {
  const caps = restrictFinancialCapabilities(new Set(granted));
  const sales = caps.has("can_view_sales"), profit = caps.has("can_view_profit");
  if (/^\/api\/admin\/(invoices|invoice-addresses|invoice-principal|counterparties|course-billing|course-rates)(\/|$)/.test(path) && (!sales || !profit)) return new Error("権限がありません");
  if (/^\/api\/admin\/(payments|monthly|driver-rewards|driver-expenses|driver-ad-hoc-expenses|driver-lease)(\/|$)/.test(path) && !caps.has("can_view_rewards") && !caps.has("can_manage_rewards")) return new Error("権限がありません");
  if (path === "/api/admin/sales" && !sales && !profit) return new Error("権限がありません");
  if (/^\/api\/admin\/sales\/log(?:\/[^/]+)?$/.test(path) && method !== "GET" && (!sales || !profit)) return new Error("権限がありません");
  return null;
}
