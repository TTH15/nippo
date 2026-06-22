// ============================================================
// Phase9 前提のデータ整備: v2 mirror が欠落している旧 daily_reports を
// syncLegacyReportToV2 で v2(+report_entries) に再生成する。
//   下見(既定): npx tsx src/scripts/backfill-v2-mirror.ts 2026-04
//   反映:       npx tsx src/scripts/backfill-v2-mirror.ts 2026-04 --apply
//   全期間:     npx tsx src/scripts/backfill-v2-mirror.ts all --apply
// legacySync 導入前に提出され後で承認された等の旧行は v2 に無く、v2 readers が
// 取りこぼす。9-W(書込フリップ)の前に解消しておく。
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// legacySync は @/ エイリアス & 共有 supabase を使うため、ここでは同等処理を内製せず
// 動的 import で再利用する（同じ env の supabase を使う）。
async function main() {
  const arg = process.argv[2] || "all";
  const apply = process.argv.includes("--apply");
  const range =
    arg === "all"
      ? null
      : (() => {
          const [y, m] = arg.split("-").map(Number);
          const last = new Date(y, m, 0).getDate();
          const mm = String(m).padStart(2, "0");
          return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
        })();

  console.log(
    `\n=== v2 mirror backfill ${arg} (${apply ? "APPLY" : "DRY-RUN"}) ===\n`,
  );

  let q = supabase.from("daily_reports").select("*").limit(100000);
  if (range) q = q.gte("report_date", range.start).lte("report_date", range.end);
  const { data: oldRows, error } = await q;
  if (error) throw error;

  // 既存 v2 の legacy_report_id 集合
  const { data: v2Rows } = await supabase
    .from("daily_reports_v2")
    .select("legacy_report_id")
    .not("legacy_report_id", "is", null)
    .limit(100000);
  const linked = new Set((v2Rows ?? []).map((r: { legacy_report_id: string }) => r.legacy_report_id));

  const missing = (oldRows ?? []).filter((o: { id: string }) => !linked.has(o.id));
  console.log(`旧行 ${oldRows?.length ?? 0} / v2欠落 ${missing.length}`);

  if (missing.length === 0) {
    console.log("\n✅ 欠落なし\n");
    return;
  }
  for (const o of missing.slice(0, 20)) {
    console.log(`  - ${String(o.id).slice(0, 8)} ${o.report_date} ${o.carrier} approved=${!!o.approved_at}`);
  }
  if (missing.length > 20) console.log(`  … 他 ${missing.length - 20} 件`);

  if (!apply) {
    console.log(`\n（DRY-RUN。反映するには --apply を付けて再実行）\n`);
    return;
  }

  const { syncLegacyReportToV2 } = await import("../server/aggregation/legacySync");
  let done = 0;
  for (const o of missing) {
    try {
      await syncLegacyReportToV2(o as Parameters<typeof syncLegacyReportToV2>[0]);
      done += 1;
    } catch (e) {
      console.error("  ✗ sync 失敗", String(o.id).slice(0, 8), e);
    }
  }
  console.log(`\n✅ backfill 完了: ${done}/${missing.length}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
