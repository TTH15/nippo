import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { framesOf } from "@/server/shifts/readinessData";
import { parseStaffingInput } from "@/server/shifts/staffingInput";

export const dynamic = "force-dynamic";

// ============================================================
// 日×コース×便の必要人数（配置とは別に管理する共有の基準）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// GET  : 曜日の基準と、期間内の日付ごとの指定
// PUT  : 曜日の基準／日付の指定の保存。state=null はその指定を消す
// ============================================================

const isDateOnly = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** 削除条件を1リクエストにまとめる件数。URL が長くなりすぎない範囲にとどめる */
const DELETE_BATCH_SIZE = 50;

/** 自社のコース×便（アーカイブ済み・停止中の便は選べない） */
async function loadFrames(orgId: string) {
  const { data, error } = await supabase
    .from("courses")
    .select("id, name, uses_cycles, archived_at, meeting_place, meeting_time, arrival_time, end_time, course_cycles(cycle_no, label, meeting_place, meeting_time, arrival_time, end_time, active)")
    .eq("org_id", orgId);
  if (error) throw error;
  return framesOf((data ?? []) as Parameters<typeof framesOf>[0]);
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  // 期間の指定が無ければ曜日の基準だけを返す（設定画面はこちらしか使わない）
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  const wantsDates = start != null || end != null;
  if (wantsDates && (!isDateOnly(start) || !isDateOnly(end) || start > end)) {
    return NextResponse.json({ error: "有効な開始日・終了日を指定してください" }, { status: 400 });
  }

  const [baselines, requirements] = await Promise.all([
    supabase.from("shift_staffing_baselines").select("course_id, cycle_no, weekday, state, required_count").eq("org_id", orgId),
    wantsDates
      ? supabase.from("shift_staffing_requirements").select("shift_date, course_id, cycle_no, state, required_count, note").eq("org_id", orgId).gte("shift_date", start as string).lte("shift_date", end as string)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (baselines.error || requirements.error) {
    console.error("[shift requirements] load error", baselines.error ?? requirements.error);
    // migration 168 未適用でも画面を止めない
    return NextResponse.json({ baselines: [], requirements: [], unavailable: true });
  }
  return NextResponse.json({ baselines: baselines.data ?? [], requirements: requirements.data ?? [], unavailable: false });
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  let frames: Awaited<ReturnType<typeof loadFrames>>;
  try {
    frames = await loadFrames(orgId);
  } catch (error) {
    console.error("[shift requirements] frames error", error);
    return NextResponse.json({ error: "保存に必要な情報を取得できませんでした" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = parseStaffingInput(body, { allowedFrames: new Set(frames.map((f) => `${f.courseId}|${f.cycleNo}`)) });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const now = new Date().toISOString();
  const fail = (error: unknown) => {
    console.error("[shift requirements] save error", error);
    return NextResponse.json({ error: "必要人数を保存できませんでした" }, { status: 500 });
  };

  // 消す指定を先に片付けてから入れ直す（同じ枠に消しと保存が混ざっても結果が変わらない）。
  // 1件ずつ往復すると件数ぶんラウンドトリップし、途中で切れると「前半だけ消えた」状態で
  // 画面と DB が食い違うので、まとめて送る。
  const removedRequirements = parsed.requirements.filter((r) => r.state === null);
  for (let i = 0; i < removedRequirements.length; i += DELETE_BATCH_SIZE) {
    const batch = removedRequirements.slice(i, i + DELETE_BATCH_SIZE);
    const conditions = batch
      .map((r) => `and(shift_date.eq.${r.date},course_id.eq.${r.courseId},cycle_no.eq.${r.cycleNo})`)
      .join(",");
    const { error } = await supabase.from("shift_staffing_requirements").delete().eq("org_id", orgId).or(conditions);
    if (error) return fail(error);
  }
  const keptRequirements = parsed.requirements.filter((r) => r.state !== null);
  if (keptRequirements.length > 0) {
    // tenant-scope-ok: 各行に認証済み orgId を設定し、コース・便は自社の枠だけを許可済み
    const { error } = await supabase.from("shift_staffing_requirements").upsert(
      keptRequirements.map((r) => ({
        org_id: orgId,
        shift_date: r.date,
        course_id: r.courseId,
        cycle_no: r.cycleNo,
        state: r.state,
        required_count: r.requiredCount,
        note: r.note,
        updated_by: user.driverId,
        updated_at: now,
      })),
      { onConflict: "org_id,shift_date,course_id,cycle_no" },
    );
    if (error) return fail(error);
  }

  const removedBaselines = parsed.baselines.filter((b) => b.state === null);
  for (let i = 0; i < removedBaselines.length; i += DELETE_BATCH_SIZE) {
    const batch = removedBaselines.slice(i, i + DELETE_BATCH_SIZE);
    const conditions = batch
      .map((b) => `and(course_id.eq.${b.courseId},cycle_no.eq.${b.cycleNo},weekday.eq.${b.weekday})`)
      .join(",");
    const { error } = await supabase.from("shift_staffing_baselines").delete().eq("org_id", orgId).or(conditions);
    if (error) return fail(error);
  }
  const keptBaselines = parsed.baselines.filter((b) => b.state !== null);
  if (keptBaselines.length > 0) {
    // tenant-scope-ok: 各行に認証済み orgId を設定し、コース・便は自社の枠だけを許可済み
    const { error } = await supabase.from("shift_staffing_baselines").upsert(
      keptBaselines.map((b) => ({
        org_id: orgId,
        course_id: b.courseId,
        cycle_no: b.cycleNo,
        weekday: b.weekday,
        state: b.state,
        required_count: b.requiredCount,
        updated_by: user.driverId,
        updated_at: now,
      })),
      { onConflict: "org_id,course_id,cycle_no,weekday" },
    );
    if (error) return fail(error);
  }

  return NextResponse.json({ ok: true });
}
