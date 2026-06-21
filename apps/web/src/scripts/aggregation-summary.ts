// ============================================================
// 新モデルの月次サマリを出力（既存 /admin/sales・/admin/payments と目視突合用）
//   npx tsx src/scripts/aggregation-summary.ts 2026-04
// SELECT のみ・非破壊。.env.local の Supabase を読む。
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
import { loadAggregationData } from "../server/aggregation/load";
import { buildContext, buildContributions, sumBy, total } from "../server/aggregation/compute";

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

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

async function main() {
  const month = process.argv[2] || "2026-04";
  const { start, end } = monthRange(month);
  console.log(`\n=== 新モデル月次サマリ ${month} (${start}〜${end}) ===\n`);

  const data = await loadAggregationData(supabase, start, end);
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates);
  const contribs = buildContributions(data.reports, data.ledger, ctx);

  const codeByCarrier = new Map(data.carriers.map((c) => [c.id, c.code]));

  console.log(`日報(v2): ${data.reports.length}件 / 台帳: ${data.ledger.length}件 / 明細(contrib): ${contribs.length}\n`);

  // --- 売上（既存 /admin/sales 相当） ---
  const auto = contribs.filter((c) => c.source !== "ledger");
  const byCarrier = sumBy(auto, (c) => c.carrierId);
  let yamatoRev = 0, yamatoProfit = 0, amazonRev = 0, amazonProfit = 0;
  for (const [carrierId, m] of byCarrier) {
    const code = codeByCarrier.get(carrierId ?? "");
    if (code === "YAMATO") { yamatoRev += m.revenue; yamatoProfit += m.profit; }
    else if (code === "AMAZON") { amazonRev += m.revenue; amazonProfit += m.profit; }
    else { yamatoRev += m.revenue; yamatoProfit += m.profit; } // 旧仕様: OTHER はヤマト枠
  }
  const ledgerOnly = contribs.filter((c) => c.source === "ledger");
  const otherRev = ledgerOnly.reduce((s, c) => s + c.revenue, 0);
  const grandProfit = total(contribs).profit;

  console.log("【売上】（/admin/sales と比較）");
  console.log(`  ヤマト売上: ${yen(yamatoRev)} / 利益 ${yen(yamatoProfit)}`);
  console.log(`  Amazon売上: ${yen(amazonRev)} / 利益 ${yen(amazonProfit)}`);
  console.log(`  その他(売上ログ): ${yen(otherRev)}`);
  console.log(`  総利益: ${yen(grandProfit)}\n`);

  // --- 支払（既存 /admin/payments の incomeLog/adHoc 相当） ---
  const payoutByDriver = sumBy(contribs, (c) => c.driverId);
  const autoPayoutByDriver = sumBy(auto, (c) => c.driverId);
  const ledgerPayoutByDriver = sumBy(ledgerOnly, (c) => c.driverId);

  console.log("【ドライバー支払】（/admin/payments と比較。net は固定控除を別途差引く前）");
  const driverIds = new Set<string>();
  payoutByDriver.forEach((_v, k) => driverIds.add(k));
  for (const d of driverIds) {
    const income = autoPayoutByDriver.get(d)?.payout ?? 0;       // = 旧 incomeLog
    const adhoc = -(ledgerPayoutByDriver.get(d)?.payout ?? 0);   // = 旧 adHocDeductions
    console.log(`  driver ${d}: 収入(自動) ${yen(income)} / 台帳調整(控除換算) ${yen(adhoc)}`);
  }
  console.log("\n（固定控除 driver_fixed_expenses は ledger 化していないため、net = 収入 + 台帳 − 固定控除 で算出）");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
