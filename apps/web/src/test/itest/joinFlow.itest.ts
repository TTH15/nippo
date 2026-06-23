// ============================================================
// Phase 7a 参加フロー＋承認の隔離テスト（env-gated・*.itest.ts）。
// ルートハンドラはグローバル supabase を使うため、ここでは route が依存する
// DB 不変条件（pending のロスター除外 / org ガードで他テナント承認不可 / join_code 一意）を
// テストDB上で直接検証する。本番テナント(ACE)には触れない。
// ★テストブランチに migration 088（drivers.status）まで適用済みであること。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasTestDb, testClient, seedTenant, cleanupTenant, type SeededTenant } from "./harness";
import { generateJoinCode } from "@/server/tenant/joinCode";
import type { SupabaseClient } from "@supabase/supabase-js";

const run = hasTestDb() ? describe : describe.skip;

run("Phase 7 join flow isolation (itest)", () => {
  const db: SupabaseClient = hasTestDb() ? testClient() : (null as unknown as SupabaseClient);
  let A: SeededTenant;
  let B: SeededTenant;
  const date = "2025-01-15";

  beforeAll(async () => {
    A = await seedTenant(db, "P7A", date);
    B = await seedTenant(db, "P7B", date);
  });
  afterAll(async () => {
    if (A) await cleanupTenant(db, A.orgId);
    if (B) await cleanupTenant(db, B.orgId);
  });

  it("pending 申請は active ロスターに出ず、pending フィルタにだけ出る", async () => {
    const { data: pend } = await db
      .from("drivers")
      .insert({ org_id: A.orgId, role: "DRIVER", status: "pending", name: "申請者A" })
      .select("id")
      .single();

    const active = await db
      .from("drivers")
      .select("id")
      .eq("org_id", A.orgId)
      .eq("role", "DRIVER")
      .eq("status", "active");
    expect((active.data ?? []).some((r) => r.id === pend!.id)).toBe(false);

    const pending = await db
      .from("drivers")
      .select("id")
      .eq("org_id", A.orgId)
      .eq("role", "DRIVER")
      .eq("status", "pending");
    expect((pending.data ?? []).some((r) => r.id === pend!.id)).toBe(true);

    await db.from("drivers").delete().eq("id", pend!.id);
  });

  it("承認は org ガードで他テナントから不可（cross-org update は 0 行）", async () => {
    const { data: pend } = await db
      .from("drivers")
      .insert({ org_id: A.orgId, role: "DRIVER", status: "pending", name: "申請者A2" })
      .select("id")
      .single();

    // 別テナント(B)のスコープで承認しようとしても当たらない
    const wrong = await db
      .from("drivers")
      .update({ status: "active" })
      .eq("id", pend!.id)
      .eq("org_id", B.orgId)
      .select("id");
    expect(wrong.data ?? []).toHaveLength(0);

    // 正しい org なら承認できる
    const ok = await db
      .from("drivers")
      .update({ status: "active" })
      .eq("id", pend!.id)
      .eq("org_id", A.orgId)
      .select("id");
    expect(ok.data ?? []).toHaveLength(1);

    await db.from("drivers").delete().eq("id", pend!.id);
  });

  it("join_code は一意制約で重複できない", async () => {
    const code = generateJoinCode();
    const u1 = await db.from("organizations").update({ join_code: code }).eq("id", A.orgId).select("id");
    expect(u1.error).toBeNull();

    const u2 = await db.from("organizations").update({ join_code: code }).eq("id", B.orgId).select("id");
    expect(u2.error).not.toBeNull(); // 23505 unique violation

    await db.from("organizations").update({ join_code: null }).eq("id", A.orgId);
  });
});
