import { NextRequest, NextResponse } from "next/server";
import { requireScopedPermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { driverPlansOf } from "@/server/shifts/readinessData";

export const dynamic = "force-dynamic";

// ============================================================
// 本人が「その版の予定」を確認する。通知の既読とは別の事実として保存する。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1「本人が予定を確認する」
//
// GET  : 期間内の、自分の予定の版と今の回答
// POST : 1日ぶんの回答。送られてきた版が今の版と違えば拒否する（古い画面からの確認を通さない）
// ============================================================

const isDateOnly = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

type CourseRow = Parameters<typeof driverPlansOf>[1][number];
type ShiftRow = Parameters<typeof driverPlansOf>[0][number];

/** 自分の期間内の予定を読み、日付 → 版 にして返す */
async function loadMyPlanVersions(driverId: string, orgId: string, start: string, end: string) {
  const [shiftResult, courseResult] = await Promise.all([
    supabase
      // tenant-scope-ok: driverId は認証済みの本人。org 絞りより狭い
      .from("shifts")
      .select("shift_date, course_id, cycle_no, driver_id, vehicle_id, uses_external_vehicle, meeting_place, meeting_time, arrival_time, end_time")
      .eq("driver_id", driverId)
      .gte("shift_date", start)
      .lte("shift_date", end),
    supabase
      .from("courses")
      .select("id, name, uses_cycles, archived_at, meeting_place, meeting_time, arrival_time, end_time, course_cycles(cycle_no, label, meeting_place, meeting_time, arrival_time, end_time, active)")
      .eq("org_id", orgId),
  ]);
  if (shiftResult.error || courseResult.error) throw shiftResult.error ?? courseResult.error;
  const courses = (courseResult.data ?? []) as CourseRow[];
  const courseIds = new Set(courses.map((c) => c.id));
  // 自社のコースの予定だけを本人へ出す（壊れた横断参照を確認対象にしない）
  const shifts = ((shiftResult.data ?? []) as ShiftRow[]).filter((s) => courseIds.has(s.course_id));
  return new Map(driverPlansOf(shifts, courses).map((p) => [p.date, p.planVersion]));
}

export async function GET(req: NextRequest) {
  const user = await requireScopedPermission(req, { own: "own_view_shifts", any: "can_view_shifts" });
  if (isAuthError(user)) return user;
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!isDateOnly(start) || !isDateOnly(end) || start > end) {
    return NextResponse.json({ error: "有効な開始日・終了日を指定してください" }, { status: 400 });
  }
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  let planVersions: Map<string, string>;
  try {
    planVersions = await loadMyPlanVersions(user.driverId, orgId, start, end);
  } catch (error) {
    console.error("[me/shift-confirmations] plan load error", error);
    return NextResponse.json({ error: "予定を取得できませんでした" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("shift_plan_confirmations")
    .select("shift_date, plan_version, response, note, responded_at")
    .eq("org_id", orgId)
    .eq("driver_id", user.driverId)
    .gte("shift_date", start)
    .lte("shift_date", end);
  if (error) {
    console.error("[me/shift-confirmations] load error", error);
    // migration 168 未適用でもシフト確認画面は開けるようにする
    return NextResponse.json({ days: [], unavailable: true });
  }

  const byDate = new Map((data ?? []).map((row) => [row.shift_date as string, row]));
  const days = [...planVersions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, planVersion]) => {
      const saved = byDate.get(date);
      return {
        date,
        planVersion,
        // 版が違う確認は「確認済み」にしない。回答した内容は参考として返す
        response: saved && saved.plan_version === planVersion ? (saved.response as string) : null,
        staleResponse: saved && saved.plan_version !== planVersion ? (saved.response as string) : null,
        note: saved?.note ?? "",
        respondedAt: saved?.responded_at ?? null,
      };
    });
  return NextResponse.json({ days, unavailable: false });
}

export async function POST(req: NextRequest) {
  const user = await requireScopedPermission(req, { own: "own_view_shifts", any: "can_view_shifts" });
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "内容を確認してください" }, { status: 400 });
  const { date, planVersion, response, note } = body as Record<string, unknown>;
  if (!isDateOnly(date)) return NextResponse.json({ error: "日付が不正です" }, { status: 400 });
  if (response !== "confirmed" && response !== "unavailable") {
    return NextResponse.json({ error: "回答を選んでください" }, { status: 400 });
  }
  if (typeof planVersion !== "string" || planVersion.length === 0 || planVersion.length > 64) {
    return NextResponse.json({ error: "予定の版が不正です" }, { status: 400 });
  }
  const text = typeof note === "string" ? note.trim().slice(0, 200) : "";
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  let current: string | undefined;
  try {
    current = (await loadMyPlanVersions(user.driverId, orgId, date, date)).get(date);
  } catch (error) {
    console.error("[me/shift-confirmations] plan load error", error);
    return NextResponse.json({ error: "予定を取得できませんでした" }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: "その日の予定がありません" }, { status: 404 });
  // 予定が変わった後に古い画面から確認されても通さない（確認は今の版に対してだけ成立する）
  if (current !== planVersion) {
    return NextResponse.json({ error: "予定が変わりました。最新の予定を開いて確認してください", planVersion: current }, { status: 409 });
  }

  const now = new Date().toISOString();
  // tenant-scope-ok: org_id は認証済みの所属、driver_id は本人に固定
  const { error } = await supabase.from("shift_plan_confirmations").upsert(
    { org_id: orgId, driver_id: user.driverId, shift_date: date, plan_version: planVersion, response, note: text, responded_at: now },
    { onConflict: "org_id,driver_id,shift_date" },
  );
  if (error) {
    console.error("[me/shift-confirmations] save error", error);
    return NextResponse.json({ error: "確認を保存できませんでした" }, { status: 500 });
  }
  // 上書きされる前の回答を追えるよう、確認は追記でも残す（確認後に変えた場合の追跡）
  const { error: logError } = await supabase
    .from("shift_plan_confirmation_logs")
    .insert({ org_id: orgId, driver_id: user.driverId, shift_date: date, plan_version: planVersion, response, note: text });
  if (logError) console.error("[me/shift-confirmations] log error", logError);

  return NextResponse.json({ ok: true, planVersion });
}
