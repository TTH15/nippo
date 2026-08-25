// ============================================================
// Phase8 parity 検証: 取引先別の請求売上(新 v2 ロジック) == v2集計エンジンの
// 「その取引先のコース集合」revenue 合計、を突合する。
//   npx tsx src/scripts/check-counterparty-billing.ts 2026-04
// SELECT のみ・非破壊。.env.local の Supabase を読む。
// 請求合計が admin/sales(同じv2エンジン)と一致することを保証する安全網。
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
import { loadAggregationData } from "../server/aggregation/load";
import { buildContext, buildContributions } from "../server/aggregation/compute";
import { computeCounterpartyMonthRevenue } from "../server/billing/computeCounterpartyMonthRevenue";

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
  console.log(`\n=== Phase8 請求 parity ${month} (${start}〜${end}) ===\n`);

  const { data: org } = await supabase.from("organizations").select("id").eq("code", "ACE").single();
  const orgId = org!.id as string;
  // v2 集計の auto(従量+固定) contributions
  const data = await loadAggregationData(supabase, orgId, start, end);
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates, data.fixedRateBundles);
  const contribs = buildContributions(data.reports, [], ctx); // ledger 抜き = system auto のみ

  // course -> counterparty
  const { data: courseRows } = await supabase
    .from("courses") // tenant-scope-ok: 開発用スクリプト（手元検証・非公開）
    .select("id, counterparty_invoice_address_id");
  const cpByCourse = new Map<string, string | null>();
  (courseRows ?? []).forEach((c: { id: string; counterparty_invoice_address_id: string | null }) =>
    cpByCourse.set(String(c.id), c.counterparty_invoice_address_id ?? null),
  );

  // 取引先別の期待 revenue（contributions を course→counterparty で振り分け）
  const expectedByCp = new Map<string, number>();
  for (const c of contribs) {
    const cp = c.courseId ? cpByCourse.get(c.courseId) ?? null : null;
    if (!cp) continue;
    expectedByCp.set(cp, (expectedByCp.get(cp) ?? 0) + c.revenue);
  }

  if (expectedByCp.size === 0) {
    console.log("（この月は取引先紐付けコースの自動売上がありません）\n");
    return;
  }

  const { data: addrRows } = await supabase.from("invoice_addresses").select("id, name"); // tenant-scope-ok: 開発用スクリプト
  const nameById = new Map<string, string>();
  (addrRows ?? []).forEach((a: { id: string; name: string | null }) =>
    nameById.set(a.id, a.name ?? a.id.slice(0, 8)),
  );

  let pass = 0;
  let fail = 0;
  for (const [cp, expected] of [...expectedByCp.entries()].sort((a, b) => b[1] - a[1])) {
    const actual = await computeCounterpartyMonthRevenue(supabase, orgId, start, end, cp);
    const ok = Math.round(actual) === Math.round(expected);
    const name = nameById.get(cp) ?? cp.slice(0, 8);
    console.log(
      `  ${ok ? "✓" : "✗"} ${name.padEnd(16)} 請求=${yen(actual)}  集計=${yen(expected)}${
        ok ? "" : `  ← 差 ${yen(actual - expected)}`
      }`,
    );
    if (ok) pass += 1;
    else fail += 1;
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} parity: ${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
