/**
 * dev 用シード: 車両QRのUI確認に必要な「自分の org の車両」を用意する。
 * - 現状（organizations / drivers の role・org_id / vehicles の所有org）を表示。
 * - ドライバーが所属する各 org に「非廃車の車両」が1台も無ければ、テスト車両を1台作成。
 *   → ログイン中の運営アカウント（=その org の driver）の車両一覧に必ず出る。
 *
 * Run: cd apps/web && npx tsx src/scripts/seed-qr-test.ts
 * Requires: .env.local の SUPABASE_DB_URL（dev）。本番では実行しない。
 */
import { Client } from "pg";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL 未設定（apps/web/.env.local）");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const orgs = (await c.query("SELECT id, code, name FROM organizations ORDER BY code")).rows;
    const drivers = (await c.query("SELECT id, name, role, org_id FROM drivers ORDER BY role")).rows;
    const veh = (
      await c.query(
        "SELECT owner_org_id, count(*) FILTER (WHERE is_disposed = false)::int AS active FROM vehicles GROUP BY owner_org_id",
      )
    ).rows;

    console.log("\n=== organizations ===");
    for (const o of orgs) console.log(`  ${o.code}  ${o.id}  ${o.name ?? ""}`);
    console.log("\n=== drivers (role / org_id) ===");
    for (const d of drivers) console.log(`  ${String(d.role).padEnd(12)} ${d.name}  org=${d.org_id ?? "(null)"}`);
    console.log("\n=== vehicles (active count by owner org) ===");
    for (const v of veh) console.log(`  owner=${v.owner_org_id ?? "(null)"}  active=${v.active}`);

    // ドライバーが居る org のうち、非廃車の車両が無い org にテスト車両を作る
    const orgsWithDrivers = [...new Set(drivers.map((d) => d.org_id).filter(Boolean))];
    const activeByOrg = new Map(veh.map((v) => [v.owner_org_id, v.active]));

    let created = 0;
    for (const orgId of orgsWithDrivers) {
      if ((activeByOrg.get(orgId) ?? 0) > 0) continue;
      const num = String(1000 + created + 1).slice(-4);
      await c.query(
        `INSERT INTO vehicles (owner_org_id, manufacturer, brand, is_disposed, is_ev,
           number_prefix, number_class, number_hiragana, number_numeric,
           current_mileage, last_oil_change_mileage, oil_change_interval)
         VALUES ($1, 'テスト', 'QR確認用', false, false, '品川', '500', 'あ', $2, 12000, 9000, 3000)`,
        [orgId, num],
      );
      created++;
      console.log(`\n[seed] org=${orgId} にテスト車両を作成（品川 500 あ ${num}）`);
    }

    if (created === 0) {
      console.log("\n[seed] 既に各 org に車両があるため作成なし。一覧に出ない場合は、ログイン中アカウントの org を上の表で確認してください。");
    } else {
      console.log(`\n[seed] 完了: ${created} 台作成。ブラウザを再読み込みしてください。`);
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("[seed] ERROR:", e.message);
  process.exit(1);
});
