import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: まだどのドライバーにも紐付けられていない車両一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const { data: links, error: linksError } = await supabase
      .from("vehicle_drivers")
      .select("vehicle_id");

    if (linksError) {
      console.error(linksError);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const linkedIds = new Set(
      (links ?? [])
        .map((l: { vehicle_id: string | null }) => l.vehicle_id)
        .filter((id): id is string => !!id),
    );

    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select(
        "id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage, last_oil_change_mileage, oil_change_interval",
      )
      .order("manufacturer")
      .order("brand");

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const unlinked =
      vehicles?.filter((v: { id: string }) => !linkedIds.has(v.id)) ?? [];

    return NextResponse.json({ vehicles: unlinked });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

