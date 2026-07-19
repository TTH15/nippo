import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { normalizeTimeInput, normalizePlaceInput } from "@/server/shiftSlots/timeInput";

export const dynamic = "force-dynamic";

// POST: シフト行の時間・集合場所の個別上書き（A2 時間モデル）。
// NULL を書けば上書き解除＝コース標準に戻る（実効値 = shifts.* ?? courses.*）。
// キーが来た項目のみ更新する。時間の編集はシフト管理の範疇なので can_manage_shifts。
//   { shiftDate, courseId, slot, meetingPlace?, meetingTime?, arrivalTime?, endTime? }
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const shiftDate = typeof body.shiftDate === "string" ? body.shiftDate : "";
    const courseId = typeof body.courseId === "string" ? body.courseId : "";
    const slot = body.slot;

    if (!shiftDate || !courseId) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }
    const slotNumber = Number.isFinite(slot) && Number(slot) >= 1 ? Math.floor(Number(slot)) : 1;

    const updates: Record<string, unknown> = {};
    if ("meetingPlace" in body) updates.meeting_place = normalizePlaceInput(body.meetingPlace);
    if ("meetingTime" in body) updates.meeting_time = normalizeTimeInput(body.meetingTime);
    if ("arrivalTime" in body) updates.arrival_time = normalizeTimeInput(body.arrivalTime);
    if ("endTime" in body) updates.end_time = normalizeTimeInput(body.endTime);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No time fields to update" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("shifts")
      .update(updates)
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("slot", slotNumber)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "対象のシフトが見つかりません。先にシフトを割り当ててください。" },
        { status: 404 },
      );
    }

    return NextResponse.json({ shift: data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
