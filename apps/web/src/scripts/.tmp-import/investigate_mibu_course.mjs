import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.production.local") });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  const courseId = "67747e27-de4d-46f0-b7f9-4b33f9b5800b";
  const { data: course } = await supabase.from("courses").select("*").eq("id", courseId).single();
  console.log("=== コース詳細 ===");
  console.log(course);

  const { data: shifts } = await supabase
    .from("shifts")
    .select("driver_id, shift_date")
    .eq("course_id", courseId)
    .order("shift_date", { ascending: false })
    .limit(10);
  console.log("\n=== 直近のシフト ===");
  console.log(shifts);

  const { data: reports } = await supabase
    .from("daily_reports_v2")
    .select("id, driver_id, report_date")
    .eq("course_id", courseId)
    .order("report_date", { ascending: false })
    .limit(10);
  console.log("\n=== 直近の日報 ===");
  console.log(reports);

  const { data: yamatoCourses } = await supabase.from("courses").select("id, name").ilike("name", "ヤマト%");
  console.log("\n=== ヤマト系コース一覧 ===");
  console.log(yamatoCourses?.map((c) => c.name));

  const { data: allUnitRates } = await supabase
    .from("course_unit_rates")
    .select("course_id")
    .in("course_id", (yamatoCourses ?? []).map((c) => c.id));
  const withRate = new Set((allUnitRates ?? []).map((r) => r.course_id));
  console.log("\n単価設定ありのヤマト系コース:", yamatoCourses?.filter((c) => withRate.has(c.id)).map((c) => c.name));
  console.log("単価設定なしのヤマト系コース:", yamatoCourses?.filter((c) => !withRate.has(c.id)).map((c) => c.name));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
