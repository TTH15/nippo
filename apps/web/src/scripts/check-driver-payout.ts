// ============================================================
// 残存リーダーv2化の parity 検証: ドライバー別の自動報酬(payout)が
// 共有ヘルパ computeDriverAutoPayout の total == v2集計engineの sumBy(payout)
// と一致することを突合する（=admin/payments と同一）。
//   npx tsx src/scripts/check-driver-payout.ts 2026-04
// SELECT のみ・非破壊。.env.local の Supabase を読む。
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
import { loadAggregationData } from "../server/aggregation/load";
import { buildContext, buildContributions, sumBy } from "../server/aggregation/compute";
import { computeDriverAutoPayout } from "../server/billing/driverPayout";

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

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

async function main() {
  const month = process.argv[2] || "2026-04";
  const { start, end } = monthRange(month);
  console.log(`\n=== ドライバー報酬 parity ${month} (${start}〜${end}) ===\n`);

  const { data: org } = await supabase.from("organizations").select("id").eq("code", "ACE").single();
  const orgId = org!.id as string;
  const data = await loadAggregationData(supabase, orgId, start, end);
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates);
  const auto = buildContributions(data.reports, [], ctx); // ledger 抜き = 自動算出のみ
  const expectedByDriver = sumBy(auto, (c) => c.driverId);

  const { data: driverRows } = await supabase.from("drivers").select("id, name, display_name"); // tenant-scope-ok: 開発用スクリプト
  const nameById = new Map<string, string>();
  (driverRows ?? []).forEach((d: { id: string; name: string; display_name: string | null }) =>
    nameById.set(d.id, (d.display_name || d.name || d.id.slice(0, 6)).trim()),
  );

  let pass = 0;
  let fail = 0;
  const driverIds = [...expectedByDriver.entries()]
    .filter(([id]) => id)
    .sort((a, b) => (b[1].payout ?? 0) - (a[1].payout ?? 0));

  for (const [driverId, money] of driverIds) {
    const expected = money.payout;
    const result = await computeDriverAutoPayout(supabase, orgId, driverId!, start, end);
    // 内部整合: Σdays == Σlines == total
    const sumDays = result.days.reduce((s, d) => s + d.payout, 0);
    const sumLines = result.lines.reduce((s, l) => s + l.amount, 0);
    const ok =
      Math.round(result.total) === Math.round(expected) &&
      Math.round(sumDays) === Math.round(result.total) &&
      Math.round(sumLines) === Math.round(result.total);
    const name = nameById.get(driverId!) ?? driverId!.slice(0, 6);
    console.log(
      `  ${ok ? "✓" : "✗"} ${name.padEnd(12)} 報酬=${yen(result.total)}  集計=${yen(expected)}` +
        (ok ? "" : `  ← 差 ${yen(result.total - expected)} / days=${yen(sumDays)} lines=${yen(sumLines)}`),
    );
    if (ok) pass += 1;
    else fail += 1;
  }

  if (driverIds.length === 0) console.log("（この月は自動算出報酬のあるドライバーがいません）");
  console.log(`\n${fail === 0 ? "✅" : "❌"} parity: ${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
