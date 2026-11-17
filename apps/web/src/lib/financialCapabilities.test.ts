import { describe,it,expect } from "vitest";
import { expandCapabilities } from "@/server/auth/capabilities";
describe("売上と原価の組合せ",()=>{
 it("配車だけでは売上・利益・混在する請求を見せない",()=>{
  const c=expandCapabilities(["can_manage_shifts","can_view_billing"]);expect(c.has("can_view_sales")).toBe(false);expect(c.has("can_view_profit")).toBe(false);expect(c.has("can_view_billing")).toBe(false);
 });
 it("個人追加の売上で、既存の報酬や車両原価から利益を逆算できない",()=>{
  const c=expandCapabilities(["can_view_sales","can_view_rewards","can_manage_rewards","can_view_vehicle_cost","can_view_billing"]);
  expect([...c]).toEqual(["can_view_sales"]);
 });
 it("経営・経理は既存の請求・原価権限と両立する",()=>{
  const c=expandCapabilities(["can_view_sales","can_view_profit","can_view_rewards","can_view_billing"]);expect(c.size).toBe(4);
 });
 it("利益閲覧の取消後には請求・会社全体の原価も閉じる",()=>{
  const c=expandCapabilities(["can_view_sales","can_view_rewards","can_view_billing","can_manage_billing"]);expect(c.has("can_manage_billing")).toBe(false);expect(c.has("can_view_rewards")).toBe(false);
 });
});
