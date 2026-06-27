/**
 * dev 診断: 各 driver の role / role_id / 解決後 capabilities を表示する。
 * 「編集ペン・QRボタンが出ない（= can_manage_vehicles が無い）」原因の切り分け用。
 *
 * resolveCapabilities と同じ規則:
 *   - role_id があれば role_capabilities テーブルの権限
 *   - 無ければ DEFAULT_ROLE_CAPABILITIES[role]（ADMIN=全部）
 *
 * Run: cd apps/web && npx tsx src/scripts/check-caps.ts
 */
import { Client } from "pg";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// DEFAULT_ROLE_CAPABILITIES と同じ（ADMIN は全 capability）
const ALL = [
  "can_view_reports",
  "can_manage_reports",
  "can_view_shifts",
  "can_manage_shifts",
  "can_view_rewards",
  "can_manage_rewards",
  "can_view_bank_accounts",
  "can_view_vehicles",
  "can_manage_vehicles",
  "can_view_billing",
  "can_manage_billing",
  "can_view_members",
  "can_manage_members",
  "can_view_org_settings",
  "can_manage_org_settings",
];

async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  try {
    const drivers = (
      await c.query("SELECT id, name, role, role_id, org_id FROM drivers ORDER BY role")
    ).rows;

    for (const d of drivers) {
      let caps: string[];
      if (d.role_id) {
        const r = await c.query("SELECT capability FROM role_capabilities WHERE role_id = $1", [d.role_id]);
        caps = r.rows.map((x) => x.capability);
      } else {
        caps = d.role === "ADMIN" ? ALL : [];
      }
      const canVehicles = caps.includes("can_manage_vehicles");
      console.log(
        `\n${d.name}  role=${d.role}  role_id=${d.role_id ?? "(null)"}\n` +
          `  can_manage_vehicles: ${canVehicles ? "✅ あり" : "❌ なし"}  (caps=${caps.length})`,
      );
      if (!canVehicles) console.log(`  caps: ${caps.join(", ") || "(なし)"}`);
    }
    console.log(
      "\nヒント: ❌ の管理者は、再ログインで直らなければ custom ロール(role_id)に can_manage_vehicles が無い状態。",
    );
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("[check-caps] ERROR:", e.message);
  process.exit(1);
});
