import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import { supabase } from "@/server/db/client";
import { buildFinalizationSnapshots } from "@/server/aggregation/rateSnapshot";
import { reportLifecycleError } from "@/server/reports/lifecycleError";
import { fetchAllRows } from "@/server/aggregation/pagination";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await requirePermission(req, "can_view_shifts");
  if (isAuthError(actor)) return actor;
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!actor.orgId || !isDateOnly(start) || !isDateOnly(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 62) {
    return NextResponse.json({ error: "期間を確認してください" }, { status: 400 });
  }
  try {
    const [sessions, reports, shifts] = await Promise.all([
      fetchAllRows((from, to) => supabase.from("shift_correction_sessions").select("id,driver_id,shift_date").eq("org_id", actor.orgId).is("closed_at", null).gte("shift_date", start).lte("shift_date", end).order("id").range(from, to)),
      fetchAllRows((from, to) => supabase.from("daily_reports_v2").select("id,driver_id,report_date,course_id,cycle_no").eq("org_id", actor.orgId).not("finalized_at", "is", null).is("rejected_at", null).gte("report_date", start).lte("report_date", end).order("id").range(from, to)),
      // tenant-scope-ok: courses!inner の courses.org_id で自社の正式割当に限定する
      fetchAllRows((from, to) => supabase.from("shifts").select("id,driver_id,shift_date,course_id,cycle_no,courses!inner(org_id)").eq("courses.org_id", actor.orgId).not("driver_id", "is", null).gte("shift_date", start).lte("shift_date", end).order("id").range(from, to)),
    ]);
    const finalized = [...new Map(reports.map(r => [`${r.driver_id}:${r.report_date}`, { driver_id: r.driver_id, report_date: r.report_date }])).values()].filter(day => {
      const assigned = shifts.filter(s => s.driver_id === day.driver_id && s.shift_date === day.report_date);
      return assigned.length > 0 && assigned.every(s => reports.some(r => r.driver_id === s.driver_id && r.report_date === s.shift_date && r.course_id === s.course_id && ((r.cycle_no ?? 0) === 0 || (r.cycle_no ?? 0) === (s.cycle_no ?? 0))));
    });
    return NextResponse.json({ sessions, finalized }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "確定状態を読み込めませんでした" }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const actor = await requirePermission(req, "can_manage_members");
  if (isAuthError(actor)) return actor;
  if (!actor.capabilities?.has("can_manage_shifts") || !actor.capabilities.has("can_edit_reports") || !actor.orgId) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !isUuid(body.driverId) || !isDateOnly(body.date)) {
    return NextResponse.json({ error: "対象を確認してください" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("begin_shift_correction", {
    p_org: actor.orgId, p_actor: actor.driverId, p_driver: body.driverId, p_date: body.date, p_reason: null,
  });
  if (error?.code === "P0002") return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });
  if (error?.code === "23505") return NextResponse.json({ error: "すでに修正中です" }, { status: 409 });
  if (error) return NextResponse.json({ error: "修正を開始できませんでした" }, { status: 500 });
  return NextResponse.json({ id: data });
}

export async function PATCH(req: NextRequest) {
  const actor = await requirePermission(req, "can_manage_members");
  if (isAuthError(actor)) return actor;
  if (!actor.capabilities?.has("can_manage_shifts") || !actor.capabilities.has("can_edit_reports") || !actor.orgId) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!isUuid(body?.id)) return NextResponse.json({ error: "対象を確認してください" }, { status: 400 });
  const session = await supabase.from("shift_correction_sessions").select("driver_id,shift_date,closed_at").eq("id", body.id).eq("org_id", actor.orgId).maybeSingle();
  if (session.error) return NextResponse.json({ error: "修正状態を読み込めませんでした" }, { status: 500 });
  if (!session.data) return NextResponse.json({ error: "修正が見つかりません" }, { status: 404 });
  if (session.data.closed_at) return NextResponse.json({ ok: true });
  const source = await supabase.rpc("report_finalization_source", { p_org: actor.orgId, p_driver: session.data.driver_id, p_date: session.data.shift_date });
  if (source.error) return reportLifecycleError(source.error, "単価を読み込めませんでした");
  const { error } = await supabase.rpc("finish_shift_correction_and_finalize", { p_org: actor.orgId, p_actor: actor.driverId, p_session: body.id, p_expected: source.data, p_snapshots: buildFinalizationSnapshots(source.data) });
  if (error?.code === "P0002") return NextResponse.json({ error: "修正が見つかりません" }, { status: 404 });
  if (error?.code === "23514" || error?.code === "40001") return NextResponse.json({ error: "日報を確認してから確定してください" }, { status: 409 });
  if (error) return NextResponse.json({ error: "確定できませんでした" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
