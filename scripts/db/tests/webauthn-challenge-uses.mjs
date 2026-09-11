// 開発DBだけで一回性・競合・権限を実検証する。migration 161 の適用後に実行。
// node --test scripts/db/tests/webauthn-challenge-uses.mjs
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { parse } = require('dotenv');
const { Pool } = require('pg');
const env = parse(readFileSync(new URL('../../../apps/web/.env.dbadmin', import.meta.url)));
if (!env.DB_URL_DEV || env.DB_URL_DEV === env.DB_URL_PROD || env.DB_URL_DEV.includes('ooirajiizydcynyglvuv')) {
  throw new Error('本番とは異なる DB_URL_DEV が必要です');
}

test('開発DB: Passkeyチャレンジの原子的な消費', async (t) => {
  const pool = new Pool({ connectionString: env.DB_URL_DEV, max: 8, connectionTimeoutMillis: 10_000 });
  const hashes = [];
  const hash = () => {
    const value = createHash('sha256').update(randomUUID()).digest('hex');
    hashes.push(value);
    return value;
  };
  const consume = async (value, expiry = new Date(Date.now() + 240_000)) => {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE service_role');
      const result = await client.query('select public.consume_webauthn_challenge($1, $2) as consumed', [value, expiry]);
      return result.rows[0].consumed;
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  };
  try {
    await t.test('8接続の同時送信のうち1回だけ成功し、再送は失敗', async () => {
      const value = hash();
      const results = await Promise.all(Array.from({ length: 8 }, () => consume(value)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await consume(value), false);
    });
    await t.test('期限切れ・過大な期限・不正ハッシュを拒否', async () => {
      assert.equal(await consume(hash(), new Date(Date.now() - 1000)), false);
      assert.equal(await consume(hash(), new Date(Date.now() + 600_000)), false);
      assert.equal(await consume('invalid'), false);
    });
    await t.test('DBのロック待ち中に期限を過ぎた応答を拒否する', async () => {
      const blocker = await pool.connect();
      const waiter = await pool.connect();
      let pending;
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE public.webauthn_challenge_uses IN ACCESS EXCLUSIVE MODE');
        await waiter.query('SET ROLE service_role');
        await waiter.query("SET statement_timeout = '30s'");
        const { rows: [{ pid, expiry }] } = await waiter.query("select pg_backend_pid() as pid, clock_timestamp() + interval '15 seconds' as expiry");
        pending = waiter.query('select public.consume_webauthn_challenge($1, $2) as consumed', [hash(), expiry]);
        void pending.catch(() => {});
        // 呼び出し開始時は有効で、実際に表ロックで待機したことを確かめる。
        let waiting = false;
        for (let attempt = 0; attempt < 3 && !waiting; attempt++) {
          const { rows } = await pool.query("select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1", [pid]);
          waiting = rows[0]?.waiting === true;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(waiting, true);
        await blocker.query('select pg_sleep(greatest(0, extract(epoch from $1::timestamptz - clock_timestamp())) + 0.05)', [expiry]);
        await blocker.query('ROLLBACK');
        assert.equal((await pending).rows[0].consumed, false);
      } finally {
        await blocker.query('ROLLBACK');
        await pending?.catch(() => {});
        await waiter.query('RESET ROLE');
        await waiter.query('RESET statement_timeout');
        blocker.release();
        waiter.release();
      }
    });
    await t.test('期限切れの使用済み行を片付ける', async () => {
      const expired = hash();
      await pool.query('insert into public.webauthn_challenge_uses values ($1, now() - interval \'1 minute\')', [expired]);
      assert.equal(await consume(hash()), true);
      const result = await pool.query('select count(*)::int as n from public.webauthn_challenge_uses where challenge_hash=$1', [expired]);
      assert.equal(result.rows[0].n, 0);
    });
    await t.test('一般ロールには表とRPCの権限がない', async () => {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await pool.query(`select
          has_table_privilege($1, 'public.webauthn_challenge_uses', 'SELECT') as can_read,
          has_table_privilege($1, 'public.webauthn_challenge_uses', 'INSERT') as can_write,
          has_table_privilege($1, 'public.webauthn_challenge_uses', 'DELETE') as can_delete,
          has_function_privilege($1, 'public.consume_webauthn_challenge(text,timestamptz)', 'EXECUTE') as can_consume`, [role]);
        assert.deepEqual(rows[0], { can_read: false, can_write: false, can_delete: false, can_consume: false });
      }
    });
  } finally {
    try { await pool.query('delete from public.webauthn_challenge_uses where challenge_hash = ANY($1::text[])', [hashes]); }
    finally { await pool.end(); }
  }
});
