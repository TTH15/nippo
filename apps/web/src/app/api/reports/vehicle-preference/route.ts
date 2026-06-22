import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: ドライバーの最終選択車両
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const { data, error } = await supabase
    .from("driver_vehicle_preferences")
    .select("vehicle_id")
    .eq("driver_id", user.driverId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ vehicleId: data?.vehicle_id ?? null });
}

// PUT: ドライバーの最終選択車両を保存
export async function PUT(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { vehicleId } = body;

    if (!vehicleId || typeof vehicleId !== "string") {
      return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("driver_vehicle_preferences")
      .upsert(
        { driver_id: user.driverId, vehicle_id: vehicleId, updated_at: new Date().toISOString() },
        { onConflict: "driver_id" }
      );

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
