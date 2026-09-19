import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadReadinessSettings } from "@/server/shifts/readinessData";
import { DEFAULT_READINESS_SETTINGS, parseReadinessSettings } from "@/server/shifts/readinessSettings";

export const dynamic = "force-dynamic";

// ============================================================
// 未解決一覧の解消期限と先読み日数（会社ごと）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// 行が無い会社・migration 171 未適用の環境では既定値（3/2/1日前・14日先）で動く。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const settings = await loadReadinessSettings(supabase, orgId);
  return NextResponse.json({ settings, defaults: DEFAULT_READINESS_SETTINGS });
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => null);
  const parsed = parseReadinessSettings(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // tenant-scope-ok: org_id は認証済みの所属に固定
  const { error } = await supabase.from("shift_readiness_settings").upsert(
    {
      org_id: orgId,
      staffing_due_days: parsed.value.staffingDueDays,
      confirmation_due_days: parsed.value.confirmationDueDays,
      dispatch_due_days: parsed.value.dispatchDueDays,
      horizon_days: parsed.value.horizonDays,
      updated_by: user.driverId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) {
    console.error("[shift readiness settings] save error", error);
    // 42P01 = 表が無い（migration 171 未適用）。読み取りは既定値へ縮退するので、
    // 保存だけが原因不明で失敗しているように見えないようにする
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ error: "期限の設定はまだ使えません（migration 171 未適用）" }, { status: 503 });
    }
    return NextResponse.json({ error: "期限の設定を保存できませんでした" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, settings: parsed.value });
}
