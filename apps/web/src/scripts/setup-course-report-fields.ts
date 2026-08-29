// ============================================================
// コース（＋便）ごとに日報で使う入力項目を設定する（dry-run 既定）。
//
// 通常はコース編集モーダルの「日報項目」タブから設定する。
// このスクリプトは初期設定や一括設定用。migration 152 の適用が前提。
//
//   確認: npx tsx src/scripts/setup-course-report-fields.ts
//   反映: npx tsx src/scripts/setup-course-report-fields.ts --apply --confirm=setup-report-fields
//
// CYCLE_PLAN に「コース名 → 便番号 → 使う項目グループ」を書く。
// 便を使わないコースは便番号 0 を指定する（例: ミッドナイトは { 0: ["4便"] }）。
// ============================================================
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm=setup-report-fields");

// サイクルを使うコース: C1=午前 / C2=午後（4便は使わない）
const CYCLE_PLAN: Record<string, Record<number, string[]>> = {
  "Amazon　上鳥羽吉祥院": { 1: ["午前"], 2: ["午後"] },
  "豊中 Amazon": { 1: ["午前"], 2: ["午後"] },
};

async function main() {
  const { data: org } = await supabase.from("organizations").select("id").eq("code", "ACE").single();
  const orgId = org!.id as string;
  const { data: courses } = await supabase
    .from("courses").select("id, name, carrier_id, uses_cycles").eq("org_id", orgId);
  const { data: units } = await supabase.from("units").select("id, carrier_id, name, active");
  const { data: fields } = await supabase.from("unit_fields").select("unit_id, field_key, label, group_label");

  const rows: any[] = [];
  for (const [courseName, byCycle] of Object.entries(CYCLE_PLAN)) {
    const c: any = (courses ?? []).find((x: any) => x.name === courseName);
    if (!c) { console.log(`  ! コースが見つからない: ${courseName}`); continue; }
    const us = (units ?? []).filter((u: any) => u.carrier_id === c.carrier_id && u.active);
    console.log(`\n■ ${courseName}`);
    for (const [cycleNo, groups] of Object.entries(byCycle)) {
      for (const u of us) {
        const fs = (fields ?? []).filter((f: any) => f.unit_id === u.id && groups.includes(String(f.group_label)));
        console.log(`   C${cycleNo} ${u.name}: ${fs.map((f: any) => `${f.group_label}/${f.label}`).join(" ") || "（該当なし）"}`);
        for (const f of fs) {
          rows.push({ course_id: c.id, cycle_no: Number(cycleNo), unit_id: u.id, field_key: f.field_key });
        }
      }
    }
  }
  console.log(`\n設定する行: ${rows.length}件`);

  if (!apply) { console.log("[dry-run] --apply --confirm=setup-report-fields で反映"); return; }
  if (!confirmed) { console.log("確認フラグが違います"); return; }
  const courseIds = [...new Set(rows.map((r) => r.course_id))];
  const { error: delErr } = await supabase.from("course_report_fields").delete().in("course_id", courseIds);
  if (delErr) throw delErr;
  const { error } = await supabase.from("course_report_fields").insert(rows);
  if (error) throw error;
  console.log(`反映しました: ${rows.length}件`);
}
main().catch((e) => { console.error(e); process.exit(1); });
