// ============================================================
// 越境（マルチテナント隔離）テスト用ハーネス。
// Supabase ブランチ（テストDB）へ service role で接続し、使い捨ての
// テナント＋最小データを seed する。本番テナント(ACE)には触れない。
//   接続情報: apps/web/.env.test.local
//     SUPABASE_TEST_URL=...        (https://<ref>.supabase.co)
//     SUPABASE_TEST_SERVICE_ROLE_KEY=...
// ============================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

/** テストDBの接続情報が揃っているか（無ければ越境テストは skip）。 */
export function hasTestDb(): boolean {
  return !!url && !!key;
}

export function testClient(): SupabaseClient {
  if (!url || !key) throw new Error("SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY が未設定です");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 衝突しない一意サフィックス（同時実行・再実行でも被らない）。 */
function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export type SeededTenant = {
  orgId: string;
  code: string;
  driverId: string;
  reportId: string;
  reportDate: string;
};

/**
 * 使い捨てテナントを1つ作り、最小データ（driver / daily_reports_v2 / ledger_entries）を seed する。
 * 集計ローダの org_id 隔離を検証できる最小集合。
 */
export async function seedTenant(
  db: SupabaseClient,
  label: string,
  reportDate: string,
): Promise<SeededTenant> {
  const code = `IT_${label}_${uniq()}`.slice(0, 24);

  const { data: org, error: orgErr } = await db
    .from("organizations")
    .insert({ code, name: `IT ${label}`, status: "active" })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`);
  const orgId = org.id as string;

  const { data: driver, error: drvErr } = await db
    .from("drivers")
    .insert({
      org_id: orgId,
      company_code: code.slice(0, 3),
      name: `IT Driver ${label}`,
      role: "DRIVER",
      driver_code: `ITD${uniq()}`.slice(0, 16),
    })
    .select("id")
    .single();
  if (drvErr || !driver) throw new Error(`driver insert failed: ${drvErr?.message}`);
  const driverId = driver.id as string;

  const { data: report, error: repErr } = await db
    .from("daily_reports_v2")
    .insert({ org_id: orgId, driver_id: driverId, report_date: reportDate })
    .select("id")
    .single();
  if (repErr || !report) throw new Error(`report insert failed: ${repErr?.message}`);

  const { error: ledErr } = await db.from("ledger_entries").insert({
    org_id: orgId,
    entry_date: reportDate,
    revenue_delta: 1000,
    profit_delta: 200,
    payout_delta: 800,
    target_driver_id: driverId,
  });
  if (ledErr) throw new Error(`ledger insert failed: ${ledErr.message}`);

  return { orgId, code, driverId, reportId: report.id as string, reportDate };
}

/** seed したテナントを依存順に完全削除（本番に影響しないよう org_id 限定）。 */
export async function cleanupTenant(db: SupabaseClient, orgId: string): Promise<void> {
  await db.from("ledger_entries").delete().eq("org_id", orgId);
  await db.from("daily_reports_v2").delete().eq("org_id", orgId);
  await db.from("drivers").delete().eq("org_id", orgId);
  await db.from("organizations").delete().eq("id", orgId);
}
