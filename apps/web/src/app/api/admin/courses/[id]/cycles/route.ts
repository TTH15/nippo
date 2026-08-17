import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { normalizeTimeInput, normalizePlaceInput } from "@/server/shiftSlots/timeInput";

export const dynamic = "force-dynamic";

// ============================================================
// コースの便（course_cycles）。設計: docs/design/course-cycle.md
//
// 「サイクルを使用する」コースだけが便を持つ。使用しないコースは
// コース自身が時間を持ち、このエンドポイントは呼ばれない。
//
// PUT は「その課の便の一覧をまるごと置き換える」形にする。
// 便は数個しかなく、画面側も一覧を編集して保存する UI のため、
// 追加/更新/削除を個別 API に割るより取り違えが起きにくい。
//
// ★既存のシフト割当には遡及しない（§5-2）。便を消しても、その便で
//   既に組まれた shifts 行はそのまま残る（cycle_no が宙に浮く）。
//   運営が画面で気づいて割り当て直す。黙って過去を書き換えない。
// ============================================================

type CycleInput = {
  cycleNo?: number;
  label?: string | null;
  meetingPlace?: string | null;
  meetingTime?: string | null;
  arrivalTime?: string | null;
  endTime?: string | null;
  maxDrivers?: number | null;
};

/** 対象コースが自社のものか確認する（他社のコースを触らせない）。 */
async function assertOwnCourse(courseId: string, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("org_id", orgId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_view_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: courseId } = await ctx.params;

  if (!(await assertOwnCourse(courseId, orgId))) {
    return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("course_cycles")
    .select("*")
    .eq("course_id", courseId)
    .order("cycle_no");
  if (error) {
    console.error("[course-cycles] 取得に失敗", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ cycles: data ?? [] });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_courses");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: courseId } = await ctx.params;

  if (!(await assertOwnCourse(courseId, orgId))) {
    return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    usesCycles?: boolean;
    cycles?: CycleInput[];
  };
  const usesCycles = Boolean(body.usesCycles);
  const input = Array.isArray(body.cycles) ? body.cycles : [];

  // 便番号は 1 始まりの通し番号として振り直す（画面の並び＝便の順番）
  const rows = input.map((c, i) => ({
    course_id: courseId,
    cycle_no: Number.isInteger(c.cycleNo) && Number(c.cycleNo) >= 1 ? Number(c.cycleNo) : i + 1,
    label: normalizePlaceInput(c.label),
    meeting_place: normalizePlaceInput(c.meetingPlace),
    meeting_time: normalizeTimeInput(c.meetingTime),
    arrival_time: normalizeTimeInput(c.arrivalTime),
    end_time: normalizeTimeInput(c.endTime),
    max_drivers:
      Number.isInteger(c.maxDrivers) && Number(c.maxDrivers) >= 1 ? Number(c.maxDrivers) : null,
    sort_order: i,
  }));

  const duplicated = new Set(rows.map((r) => r.cycle_no)).size !== rows.length;
  if (duplicated) {
    return NextResponse.json({ error: "便番号が重複しています" }, { status: 400 });
  }
  if (usesCycles && rows.length === 0) {
    return NextResponse.json({ error: "サイクルを使用するには便を1つ以上作ってください" }, { status: 400 });
  }

  // 画面から消えた便を削除 → 残りを upsert。
  // 削除しても shifts 側の cycle_no は書き換えない（既存の割当に遡及しない）
  const keep = rows.map((r) => r.cycle_no);
  const delQuery = supabase.from("course_cycles").delete().eq("course_id", courseId);
  const { error: delError } = keep.length > 0 ? await delQuery.not("cycle_no", "in", `(${keep.join(",")})`) : await delQuery;
  if (delError) {
    console.error("[course-cycles] 削除に失敗", delError);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("course_cycles")
      .upsert(rows, { onConflict: "course_id,cycle_no" });
    if (error) {
      console.error("[course-cycles] 保存に失敗", error);
      return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
    }
  }

  const { error: courseError } = await supabase
    .from("courses")
    .update({ uses_cycles: usesCycles })
    .eq("id", courseId)
    .eq("org_id", orgId);
  if (courseError) {
    console.error("[course-cycles] コース設定の保存に失敗", courseError);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
