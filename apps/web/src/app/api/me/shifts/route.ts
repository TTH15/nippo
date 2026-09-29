import type { MeShiftRest } from "@repo/core/types";
import { effectiveTime } from "@/server/shifts/planVersion";
import { loadDriverSlots } from "@/server/shiftSlots/config";
import { NextRequest, NextResponse } from "next/server";
import { requireScopedPermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type MeShiftVehicle = {
  id: string;
  number_prefix: string | null;
  number_class: string | null;
  number_hiragana: string | null;
  number_numeric: string | null;
  manufacturer: string | null;
  brand: string | null;
  plate_color: string | null;
  is_unavailable: boolean | null;
  unavailable_reason: string | null;
  current_mileage: number | null;
  is_ev: boolean | null;
  last_oil_change_mileage: number | null;
  oil_change_interval: number | null;
};

type MeShift = {
  shift_date: string;
  course_name: string;
  course_color: string | null;
  slot: number;
  vehicle: MeShiftVehicle | null;
};

export async function GET(req: NextRequest) {
  // own スコープ移行(§2-6): 自分のシフト閲覧。works_as_driver を持つメンバーは
  // ロールに関わらず own で通り、シフト閲覧権限(any)持ちも自分の分を見られる。
  const user = await requireScopedPermission(req, {
    own: "own_view_shifts",
    any: "can_view_shifts",
  });
  if (isAuthError(user)) return user;

  const url = req.nextUrl;
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  if (!startParam || !endParam) {
    return NextResponse.json(
      { error: "start and end (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    // tenant-scope-ok: 認証済みの本人（user.driverId）に固定。org 絞りより狭い
    .from("shifts")
    .select(`
      shift_date,
      course_id,
      slot,
      vehicle_id, cycle_no, uses_external_vehicle, meeting_place, meeting_time, end_time,
      courses ( name, color, summary_title, meeting_place, meeting_time, end_time, course_cycles(cycle_no, label, meeting_place, meeting_time, end_time) )
    `)
    .eq("driver_id", user.driverId)
    .gte("shift_date", startParam)
    .lte("shift_date", endParam)
    .order("shift_date", { ascending: true })
    .order("slot", { ascending: true });

  if (error) {
    console.error("[/api/me/shifts] DB error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const vehicleIds = Array.from(
    new Set(
      (data ?? [])
        .map((row: any) => row.vehicle_id as string | null)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const vehicleById = new Map<string, MeShiftVehicle>();
  if (vehicleIds.length > 0) {
    const { data: vehicles, error: vErr } = await supabase
      // tenant-scope-ok: 認証済み本人のシフトに割当済みの車両集合。正式な貸与車も表示する
      .from("vehicles")
      .select(
        "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, plate_color, is_unavailable, unavailable_reason, current_mileage, is_ev, last_oil_change_mileage, oil_change_interval",
      )
      .in("id", vehicleIds);
    if (vErr) {
      console.error("[/api/me/shifts] vehicles fetch error", vErr);
    } else {
      (vehicles ?? []).forEach((v: any) => {
        vehicleById.set(v.id as string, {
          id: v.id,
          number_prefix: v.number_prefix ?? null,
          number_class: v.number_class ?? null,
          number_hiragana: v.number_hiragana ?? null,
          number_numeric: v.number_numeric ?? null,
          manufacturer: v.manufacturer ?? null,
          brand: v.brand ?? null,
          plate_color: v.plate_color ?? null,
          is_unavailable: v.is_unavailable ?? null,
          unavailable_reason: v.unavailable_reason ?? null,
          current_mileage: v.current_mileage ?? null,
          is_ev: v.is_ev ?? null,
          last_oil_change_mileage: v.last_oil_change_mileage ?? null,
          oil_change_interval: v.oil_change_interval ?? null,
        });
      });
    }
  }

  const shifts: MeShift[] = (data ?? []).map((row: any) => {
    const course = row.courses as { name: string; color?: string | null; summary_title?: string | null; meeting_place?: string | null; meeting_time?: string | null; end_time?: string | null; course_cycles?: { cycle_no: number; label: string | null; meeting_place: string | null; meeting_time: string | null; end_time: string | null }[] } | null;
    const cycle = course?.course_cycles?.find(c => c.cycle_no === row.cycle_no);
    const displayName = (course?.summary_title?.trim() || course?.name) ?? "";
    const vid = row.vehicle_id as string | null;
    return {
      shift_date: String(row.shift_date ?? ""),
      course_name: displayName,
      course_full_name: course?.name ?? null,
      cycle_label: cycle?.label ?? null,
      meeting_place: effectiveTime(row.meeting_place, cycle?.meeting_place, course?.meeting_place),
      meeting_time: effectiveTime(row.meeting_time, cycle?.meeting_time, course?.meeting_time),
      end_time: effectiveTime(row.end_time, cycle?.end_time, course?.end_time),
      uses_external_vehicle: row.uses_external_vehicle === true,
      vehicle_unavailable: !!vid && !vehicleById.has(vid),
      course_color: (course?.color as string | null) ?? null,
      slot: Number(row.slot) || 1,
      vehicle: vid ? (vehicleById.get(vid) ?? null) : null,
    };
  });

  // tenant-scope-ok: 希望休は認証済み本人だけ。閲覧権限で読み、提出権限とは分ける。
  const { data: requests, error: restError } = await supabase.from("shift_requests")
    .select("request_date, slot_id").eq("driver_id", user.driverId).eq("request_type", "OFF")
    .gte("request_date", startParam).lte("request_date", endParam);
  let slots: { id: string; name: string }[] = [];
  try { if (requests?.some(r => r.slot_id)) slots = await loadDriverSlots(supabase, user.driverId); }
  catch { /* 便名が不明でも全休には変換しない。 */ }
  const rest_days: MeShiftRest[] = (requests ?? []).map(r => ({
    date: r.request_date, kind: "requested",
    slot_label: r.slot_id ? slots.find(s => s.id === r.slot_id)?.name ?? "一部の便" : null,
  }));
  // 指定休は表示側で、取得成功時に「希望休も割当もない日」から算出する。
  return NextResponse.json({ shifts, rest_days, rest_days_unavailable: !!restError });
}
