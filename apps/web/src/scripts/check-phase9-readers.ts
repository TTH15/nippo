// ============================================================
// Phase9 Stage 9-R parity 検証: 互換リーダー loadLegacyDailyRows(v2由来) の出力が
// 旧 daily_reports 直読みと一致することを月次で突合（旧=v2 mirror の間）。
//   npx tsx src/scripts/check-phase9-readers.ts 2026-04
// SELECT のみ・非破壊。.env.local の Supabase を読む。
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
import { loadLegacyDailyRows, type LegacyDailyRow } from "../server/aggregation/legacyShape";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

// キャリアごとに「意味を持つ」カラムだけ比較する。
// 旧 daily_reports は Amazon 行の takuhaibin/nekopos 等に残骸値が入っており（v2 は正しく0）、
// 金額・集計は carrier に応じた列のみ使うため、関連列のみで一致を判定する。
const YAMATO_COLS = ["takuhaibin_completed", "takuhaibin_returned", "nekopos_completed", "nekopos_returned"];
const AMAZON_COLS = [
  "amazon_am_mochidashi",
  "amazon_am_completed",
  "amazon_pm_mochidashi",
  "amazon_pm_completed",
  "amazon_4_mochidashi",
  "amazon_4_completed",
];

async function main() {
  const month = process.argv[2] || "2026-04";
  const { start, end } = monthRange(month);
  console.log(`\n=== Phase9 互換リーダー parity ${month} (${start}〜${end}) ===\n`);

  const { data: oldRows, error } = await supabase
    .from("daily_reports")
    .select(
      "id, driver_id, driver_identity_id, report_date, carrier, takuhaibin_completed, takuhaibin_returned, nekopos_completed, nekopos_returned, amazon_am_mochidashi, amazon_am_completed, amazon_pm_mochidashi, amazon_pm_completed, amazon_4_mochidashi, amazon_4_completed, vehicle_id, meter_value, approved_at, rejected_at",
    )
    .gte("report_date", start)
    .lte("report_date", end)
    .limit(100000);
  if (error) throw error;

  // 開発用スクリプト。リクエスト文脈が無いため既定テナント(ACE)で突合する。
  const { data: org } = await supabase.from("organizations").select("id").eq("code", "ACE").single();
  const compat = await loadLegacyDailyRows(supabase, String(org?.id ?? ""), { start, end });
  const compatById = new Map(compat.map((r) => [r.id, r]));

  let pass = 0;
  let missing = 0;
  let diff = 0;
  const diffs: string[] = [];

  for (const o of oldRows ?? []) {
    const c = compatById.get(String(o.id));
    if (!c) {
      missing += 1;
      if (diffs.length < 12) diffs.push(`  ✗ v2 mirror なし: id=${String(o.id).slice(0, 8)} ${o.report_date}`);
      continue;
    }
    const problems: string[] = [];
    const orec = o as Record<string, unknown>;
    const crec = c as unknown as Record<string, unknown>;
    const cols = String(o.carrier) === "AMAZON" ? AMAZON_COLS : YAMATO_COLS;
    for (const col of cols) {
      if ((Number(orec[col]) || 0) !== (Number(crec[col]) || 0)) {
        problems.push(`${col}:旧${orec[col]}≠新${crec[col]}`);
      }
    }
    if (String(o.carrier) !== String(c.carrier)) problems.push(`carrier:${o.carrier}≠${c.carrier}`);
    if (Boolean(o.approved_at) !== Boolean(c.approved_at)) problems.push("approved不一致");
    if (Boolean(o.rejected_at) !== Boolean(c.rejected_at)) problems.push("rejected不一致");
    if ((Number(o.meter_value) || 0) !== (Number(c.meter_value) || 0)) problems.push("meter不一致");
    if (String(o.driver_identity_id ?? "") !== String(c.driver_identity_id ?? ""))
      problems.push("identity不一致");
    if (problems.length) {
      diff += 1;
      if (diffs.length < 12) diffs.push(`  ✗ ${o.report_date} ${String(o.id).slice(0, 8)}: ${problems.join(" / ")}`);
    } else {
      pass += 1;
    }
  }

  diffs.forEach((d) => console.log(d));
  const ok = missing === 0 && diff === 0;
  console.log(
    `\n${ok ? "✅" : "❌"} 旧行 ${oldRows?.length ?? 0}: 一致 ${pass} / 値差 ${diff} / mirror欠落 ${missing}\n`,
  );
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
