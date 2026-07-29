// 一時修正スクリプト: オイル交換報告の車両取り違え（2026-07-29）。実行後は削除してよい。
//   1) 7/28・7/29 の報告2件: vehicle_id 6318(4672a5aa) → 6290(91ffc692)
//   2) 6318: 誤承認で 150423→145765 に上書きされた last_oil_change_mileage を 150423 へ復旧
//   3) 6290: 承認済み 7/28 報告の効果を適用（last_oil_change_mileage = 145765）
// Run: cd apps/web && npx tsx src/scripts/fix-oil-vehicle-20260729.ts
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const V6290 = "91ffc692-0f3d-4a2e-bbe3-cc1e387c794f";
const V6318 = "4672a5aa-152a-48ea-9107-53f64e145982";
const REPORTS = ["3c684048-df03-4459-9ba2-d29c03911c7b", "4ea86961-6ea4-4ae6-bb18-aad67bda302b"];

async function main() {
  const now = new Date().toISOString();

  const { error: e1, count } = await sb
    .from("oil_change_reports")
    .update({ vehicle_id: V6290 }, { count: "exact" })
    .in("id", REPORTS)
    .eq("vehicle_id", V6318); // 二重実行ガード（既に修正済みなら 0 件）
  if (e1) throw e1;
  console.log("reports updated:", count);

  const { error: e2 } = await sb
    .from("vehicles")
    .update({ last_oil_change_mileage: 150423, updated_at: now })
    .eq("id", V6318)
    .eq("last_oil_change_mileage", 145765); // 誤値のときだけ復旧
  if (e2) throw e2;

  const { error: e3 } = await sb
    .from("vehicles")
    .update({ last_oil_change_mileage: 145765, updated_at: now })
    .eq("id", V6290);
  if (e3) throw e3;

  const { data: afterReports } = await sb
    .from("oil_change_reports")
    .select("id, report_date, vehicle_id, approved_at")
    .in("id", REPORTS);
  const { data: afterVehicles } = await sb
    .from("vehicles")
    .select("number_numeric, current_mileage, last_oil_change_mileage")
    .in("id", [V6290, V6318]);
  console.log("after reports:", JSON.stringify(afterReports, null, 1));
  console.log("after vehicles:", JSON.stringify(afterVehicles, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
