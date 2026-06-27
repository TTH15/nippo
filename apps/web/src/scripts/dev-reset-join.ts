/**
 * dev 専用: 指定電話番号のテスト参加データ（identity＋membership）を消して、
 * join → 承認 → 本登録(KYC) → 本承認 を最初から何度でも試せるようにする。
 *
 * 背景: 実機テストは単一電話番号になりがちで、migration 091② により
 * 「同一 identity が同じ org で2回目の申請」ができない。毎回これでリセットする。
 *
 * Run: cd apps/web && npx tsx src/scripts/dev-reset-join.ts <電話番号>
 *   例: npx tsx src/scripts/dev-reset-join.ts 09067545811
 *       npm -w @repo/web run dev:reset-join -- 09067545811
 *
 * ★dev/staging 専用。本番 DB の SUPABASE_DB_URL では実行しないこと。
 *   念のため drivers/identities に依存データ（日報等）があると FK で止まる＝
 *   実データ巻き込みを防ぐ安全弁になっている（強制削除はしない）。
 */
import { Client } from "pg";
import * as dotenv from "dotenv";
import path from "path";
import { toE164JP } from "../server/otp/phone";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("使い方: npx tsx src/scripts/dev-reset-join.ts <電話番号>");
    process.exit(1);
  }
  const phone = toE164JP(raw);
  if (!phone) {
    console.error(`電話番号の形式が正しくありません: ${raw}`);
    process.exit(1);
  }

  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();

  // 対象 identity（電話一致）と、それに紐づく/電話一致の membership を洗い出す。
  const ids = await c.query(`SELECT id, name FROM identities WHERE phone = $1`, [phone]);
  const identityIds = ids.rows.map((r) => r.id);
  const drv = await c.query(
    `SELECT id, name, org_id, status FROM drivers
     WHERE phone = $1 OR (identity_id IS NOT NULL AND identity_id = ANY($2))`,
    [phone, identityIds],
  );

  console.log(`対象 phone=${phone}`);
  console.log(`  identities: ${identityIds.length}`, ids.rows.map((r) => r.name));
  console.log(`  memberships(drivers): ${drv.rows.length}`, drv.rows.map((r) => `${r.name}/${r.status}`));
  if (drv.rows.length === 0 && identityIds.length === 0) {
    console.log("削除対象なし。");
    await c.end();
    return;
  }

  await c.query("BEGIN");
  try {
    const driverIds = drv.rows.map((r) => r.id);
    if (driverIds.length > 0) {
      // passkey 等 identity 子は CASCADE。driver は依存(日報等)があれば FK で例外＝安全弁。
      await c.query(`DELETE FROM drivers WHERE id = ANY($1)`, [driverIds]);
    }
    if (identityIds.length > 0) {
      await c.query(`DELETE FROM identities WHERE id = ANY($1)`, [identityIds]);
    }
    await c.query("COMMIT");
    console.log("リセット完了。join からやり直せます。");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("削除に失敗（依存データがある可能性＝安全弁）:", (e as Error).message);
    process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
