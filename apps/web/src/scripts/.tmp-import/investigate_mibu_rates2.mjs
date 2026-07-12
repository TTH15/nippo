import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.production.local") });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  const courseId = "67747e27-de4d-46f0-b7f9-4b33f9b5800b";
  const { data, error } = await supabase.from("course_unit_rates").select("*").eq("course_id", courseId);
  console.log("=== course_unit_rates (壬生) ===");
  console.log("error:", error);
  console.log(data);

  const { data: fixed, error: fErr } = await supabase.from("course_fixed_rates").select("*").eq("course_id", courseId);
  console.log("\n=== course_fixed_rates (壬生) ===");
  console.log("error:", fErr);
  console.log(fixed);

  // unit名も引く
  const unitIds = [...new Set((data ?? []).map((r) => r.unit_id))];
  const { data: units } = await supabase.from("units").select("id, name, billing_type").in("id", unitIds.length ? unitIds : ["-"]);
  console.log("\n=== 対象unit ===");
  console.log(units);
}

main().catch((e) => { console.error(e); process.exit(1); });
