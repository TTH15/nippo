import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type MeShift = {
  shift_date: string;
  course_name: string;
  course_color: string | null;
  slot: number;
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
      courses ( name, color )
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

  const shifts: MeShift[] = (data ?? []).map((row: any) => {
    const course = row.courses as { name: string; color?: string | null } | null;
    return {
      shift_date: String(row.shift_date ?? ""),
      course_name: course?.name ?? "",
      course_color: (course?.color as string | null) ?? null,
      slot: Number(row.slot) || 1,
    };
  });

  return NextResponse.json({ shifts });
}

