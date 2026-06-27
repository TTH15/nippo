/**
 * dev 用: 管理者(role=ADMIN)のパスワードを既知の値にリセットする。
 * パスワードを忘れたときの復旧用。本番では実行しない。
 *
 * Run: cd apps/web && npx tsx src/scripts/reset-admin-password.ts [新パスワード(8文字以上)]
 *   省略時は "admin1234"。
 * 実行後に表示される「管理者コード(driver_code)」＋このパスワードでログインできる。
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const password = process.argv[2] || "admin1234";
  if (password.length < 8) throw new Error("パスワードは8文字以上で指定してください");

  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  try {
    const admins = (
      await c.query("SELECT id, name, driver_code, company_code FROM drivers WHERE role = 'ADMIN'")
    ).rows;
    if (admins.length === 0) {
      console.log("ADMIN ロールの driver が見つかりません。");
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    for (const a of admins) {
      await c.query("UPDATE drivers SET pin_hash = $1 WHERE id = $2", [hash, a.id]);
      console.log(
        `\n✅ ${a.name}\n   管理者コード: ${a.driver_code ?? "(未設定!)"}   会社コード: ${a.company_code ?? "(未設定)"}`,
      );
    }
    console.log(`\nパスワードを「${password}」にリセットしました。`);
    console.log("→ ログアウト後、上の『管理者コード』＋このパスワードで管理者ログインしてください。");
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("[reset-admin-password] ERROR:", e.message);
  process.exit(1);
});
