// 越境（マルチテナント隔離）テスト — 実DB(Supabase ブランチ)に接続。
// creds 未設定なら自動 skip。`npm run test:itest` で実行。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasTestDb, testClient, seedTenant, cleanupTenant, type SeededTenant } from "./harness";
import { loadAggregationData } from "@/server/aggregation/load";

const DATE = "2099-01-15"; // 本番データと被らない未来日

describe.skipIf(!hasTestDb())("tenant isolation (org_id scoping)", () => {
  let db: SupabaseClient;
  let A: SeededTenant;
  let B: SeededTenant;

  beforeAll(async () => {
    db = testClient();
    A = await seedTenant(db, "A", DATE);
    B = await seedTenant(db, "B", DATE);
  });

  afterAll(async () => {
    if (A) await cleanupTenant(db, A.orgId);
    if (B) await cleanupTenant(db, B.orgId);
  });

  it("loadAggregationData は自テナントの日報のみ返す（集計＝お金の経路）", async () => {
    const a = await loadAggregationData(db, A.orgId, DATE, DATE);
    const aReportIds = a.reports.map((r) => r.id);
    expect(aReportIds).toContain(A.reportId);
    expect(aReportIds).not.toContain(B.reportId);

    const b = await loadAggregationData(db, B.orgId, DATE, DATE);
    const bReportIds = b.reports.map((r) => r.id);
    expect(bReportIds).toContain(B.reportId);
    expect(bReportIds).not.toContain(A.reportId);
  });

  it("loadAggregationData の ledger も自テナントのみ（他社の売上が混ざらない）", async () => {
    const a = await loadAggregationData(db, A.orgId, DATE, DATE);
    const aDrivers = new Set(a.ledger.map((l) => l.targetDriverId));
    expect(aDrivers.has(A.driverId)).toBe(true);
    expect(aDrivers.has(B.driverId)).toBe(false);
  });

  it("org_id ガード付き mutation は他テナント行を消せない", async () => {
    // A の org スコープで B の日報 id を削除しようとしても 0 件（=守られている）。
    await db.from("daily_reports_v2").delete().eq("id", B.reportId).eq("org_id", A.orgId);
    const { data: stillThere } = await db
      .from("daily_reports_v2")
      .select("id")
      .eq("id", B.reportId)
      .maybeSingle();
    expect(stillThere?.id).toBe(B.reportId);
  });
});
