/**
 * Migration runner: supabase/migrations/*.sql を番号順に DB へ適用する。
 * すべて冪等に書かれているため再実行しても安全（CREATE TABLE IF NOT EXISTS / DO ブロック等）。
 *
 * 用途: 新規 dev/staging Supabase に 001〜最新を一括適用する。
 * Run: cd apps/web && npx tsx src/scripts/apply-migrations.ts
 * Requires: .env.local に SUPABASE_DB_URL（Supabase の接続文字列）
 *   - Settings → Database → Connection string の「Session pooler」を推奨
 *     （直結 db.<ref>:5432 は IPv6 で届かない環境がある）。
 *   - 例: postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
 *
 * ★本番に対しては実行しないこと（dev/staging 専用）。実行時 INSERT を弾きうる
 *   制約系 migration（086 等）を含むため、本番は従来どおり慎重に。
 */
import { Client } from "pg";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("[migrate] SUPABASE_DB_URL が未設定です（apps/web/.env.local に設定してください）");
  process.exit(1);
}

const migrationsDir = path.resolve(process.cwd(), "../../supabase/migrations");

async function main() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001_, 002_, ... の番号順

  if (files.length === 0) {
    console.error(`[migrate] migration が見つかりません: ${migrationsDir}`);
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // 適用済みを記録する台帳。これにより未適用の migration だけを流す（再実行安全）。
    // 初期 migration（001 等）は冪等でないため、台帳での skip が必須。
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const appliedRes = await client.query<{ name: string }>(`SELECT name FROM _migrations`);
    const applied = new Set(appliedRes.rows.map((r) => r.name));

    const pending = files.filter((f) => !applied.has(f));
    console.log(`[migrate] connected. applied=${applied.size}, pending=${pending.length}`);

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      process.stdout.write(`  - ${file} ... `);
      try {
        await client.query(sql);
        await client.query(`INSERT INTO _migrations(name) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
        console.log("ok");
      } catch (e) {
        console.log("FAILED");
        console.error(`\n[migrate] ${file} で失敗:`, e instanceof Error ? e.message : e);
        throw e;
      }
    }
    console.log("[migrate] done.");
  } finally {
    await client.end();
  }
}

main().catch(() => process.exit(1));
