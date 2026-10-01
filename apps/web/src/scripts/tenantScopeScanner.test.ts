import { describe, expect, it } from "vitest";
import { scanTenantQueries, tenantTablesFromSql } from "./tenantScopeScanner";
const tables = new Map([["drivers", "org_id"]]);
describe("tenant scope scanner", () => {
 it.each(['.update({ name: "x" }).eq("id", id)', '.delete().in("id", ids)', '.select("id").eq("id", id)'])("idだけのクエリを除外しない: %s", tail => {
   expect(scanTenantQueries(`db.from("drivers")${tail}`, tables)).toHaveLength(1);
 });
 it("隣の安全なクエリの条件を流用しない", () => {
   expect(scanTenantQueries('db.from("drivers").delete().eq("id", id); db.from("drivers").select().eq("org_id", orgId);', tables)).toHaveLength(1);
 });
 it("長い更新チェーンも最後まで検査", () => {
   expect(scanTenantQueries(`db.from("drivers").update({${Array.from({length: 30}, (_,i)=>`a${i}: 0`).join(',\n')}}).eq("org_id", orgId)`, tables)).toEqual([]);
 });
 it("更新ペイロードのorgは行の絞り込みの代わりにならない", () => {
   expect(scanTenantQueries('db.from("drivers").update({org_id: orgId}).eq("id", id)', tables)).toHaveLength(1);
 });
 it("schema付きSQLのtenant列も抽出", () => {
   expect(tenantTablesFromSql('ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS org_id uuid;').get('drivers')).toBe('org_id');
 });
 it("親車両で会社が決まる子表はID絞りだけでは通さない", () => {
   const children = new Map([["vehicle_recovery_entries", "__parent_vehicle_scope__"]]);
   expect(scanTenantQueries('db.from("vehicle_recovery_entries").delete().eq("vehicle_id", id)', children)).toHaveLength(1);
   expect(scanTenantQueries('// tenant-scope-ok: 自社車両のIDを確認済み\ndb.from("vehicle_recovery_entries").delete().eq("vehicle_id", id)', children)).toEqual([]);
 });
});
