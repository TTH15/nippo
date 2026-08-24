import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  isMemoRangeValid,
  parseShiftMemoDays,
  type ShiftMemoDay,
} from "@/server/shiftMemos/schema";

export const dynamic = "force-dynamic";

function rowToDay(row: {
  memo_date: string;
  placements: unknown;
  note: string | null;
  updated_at: string | null;
}): ShiftMemoDay {
  const parsed = parseShiftMemoDays([
    { date: row.memo_date, placements: row.placements, note: row.note ?? "" },
  ]);
  const day = parsed.ok
    ? parsed.days[0]
    : { date: row.memo_date, placements: [], note: row.note?.slice(0, 2000) ?? "" };
  return { ...day, updatedAt: row.updated_at };
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const start = req.nextUrl.searchParams.get("start") ?? "";
  const end = req.nextUrl.searchParams.get("end") ?? "";
  if (!isMemoRangeValid(start, end)) {
    return NextResponse.json({ error: "start/end は31日以内の有効な期間で指定してください" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shift_memo_days")
    .select("memo_date, placements, note, updated_at")
    .eq("org_id", orgId)
    .gte("memo_date", start)
    .lte("memo_date", end)
    .order("memo_date");
  if (error) {
    console.error("[shift memo] load error", error);
    // アプリ先行デプロイでも正式シフト画面は壊さず、メモだけ準備中として表示する。
    return NextResponse.json({ days: [], unavailable: true });
  }
  return NextResponse.json({ days: (data ?? []).map(rowToDay), unavailable: false });
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.days)) {
    return NextResponse.json({ error: "days is required" }, { status: 400 });
  }

  const [{ data: courses, error: courseError }, { data: drivers, error: driverError }] =
    await Promise.all([
      supabase.from("courses").select("id").eq("org_id", orgId),
      supabase.from("drivers").select("id").eq("org_id", orgId),
    ]);
  if (courseError || driverError) {
    console.error("[shift memo] master load error", courseError || driverError);
    return NextResponse.json({ error: "保存に必要な情報を取得できませんでした" }, { status: 500 });
  }

  const parsed = parseShiftMemoDays(body.days, {
    allowedCourseIds: new Set((courses ?? []).map((row) => row.id)),
    allowedDriverIds: new Set((drivers ?? []).map((row) => row.id)),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });

  const emptyDates = parsed.days
    .filter((day) => day.placements.length === 0 && day.note.trim() === "")
    .map((day) => day.date);
  const keptDays = parsed.days.filter(
    (day) => day.placements.length > 0 || day.note.trim() !== "",
  );

  if (emptyDates.length > 0) {
    const { error } = await supabase
      .from("shift_memo_days")
      .delete()
      .eq("org_id", orgId)
      .in("memo_date", emptyDates);
    if (error) {
      console.error("[shift memo] delete error", error);
      return NextResponse.json({ error: "シフトメモを保存できませんでした" }, { status: 500 });
    }
  }

  if (keptDays.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("shift_memo_days").upsert(
      keptDays.map((day) => ({
        org_id: orgId,
        memo_date: day.date,
        placements: day.placements,
        note: day.note,
        updated_by: user.driverId,
        updated_at: now,
      })),
      { onConflict: "org_id,memo_date" },
    );
    if (error) {
      console.error("[shift memo] upsert error", error);
      return NextResponse.json({ error: "シフトメモを保存できませんでした" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

