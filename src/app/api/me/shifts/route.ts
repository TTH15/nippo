import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
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
};

type MeShift = {
  shift_date: string;
  course_name: string;
  course_color: string | null;
  slot: number;
  vehicle: MeShiftVehicle | null;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
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
    .from("shifts")
    .select(`
      shift_date,
      course_id,
      slot,
      vehicle_id,
      courses ( name, color, summary_title )
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
      .from("vehicles")
      .select(
        "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand",
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
        });
      });
    }
  }

  const shifts: MeShift[] = (data ?? []).map((row: any) => {
    const course = row.courses as { name: string; color?: string | null; summary_title?: string | null } | null;
    const displayName = (course?.summary_title?.trim() || course?.name) ?? "";
    const vid = row.vehicle_id as string | null;
    return {
      shift_date: String(row.shift_date ?? ""),
      course_name: displayName,
      course_color: (course?.color as string | null) ?? null,
      slot: Number(row.slot) || 1,
      vehicle: vid ? (vehicleById.get(vid) ?? null) : null,
    };
  });

  return NextResponse.json({ shifts });
}

