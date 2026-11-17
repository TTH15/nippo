/** 運行用のコース応答に金額を混ぜない。単価本体は専用APIで認可する。 */
export function serializeOperationalCourse<T extends Record<string, unknown>>(course: T, caps?: ReadonlySet<string>): T {
  if (caps?.has("can_view_sales") && caps.has("can_view_profit")) return course;
  const result = { ...course };
  delete result.daily_lease;
  return result;
}
