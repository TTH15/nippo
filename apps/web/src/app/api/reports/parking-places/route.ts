import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import type { ParkingPlaceOption } from "@repo/core/types";

export const dynamic = "force-dynamic";

// GET: 日報の「車の置き場所」で選べる登録車庫と区画（ドライバー向け・自社の候補だけ）。
// 管理者向け地図APIとは分け、駐車候補に必要な項目だけを返す。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const [placesRes, slotsRes] = await Promise.all([
    supabase.from("map_places").select("id, name, lat, lng, icon, allow_parking").eq("org_id", orgId).order("name"),
    supabase.from("parking_slots").select("id, place_id, label, vehicle_id").eq("org_id", orgId).order("label"),
  ]);
  if (placesRes.error) {
    console.error(placesRes.error);
    return NextResponse.json({ error: "車庫の取得に失敗しました" }, { status: 500 });
  }
  // migration 158 未適用（allow_parking 列が無い）でも候補は出す
  const slotsByPlace = new Map<string, ParkingPlaceOption["slots"]>();
  for (const slot of slotsRes.data ?? []) {
    const list = slotsByPlace.get(slot.place_id) ?? [];
    list.push({ id: slot.id, label: slot.label, vehicleId: slot.vehicle_id ?? null });
    slotsByPlace.set(slot.place_id, list);
  }
  const places: ParkingPlaceOption[] = (placesRes.data ?? [])
    .filter((place) => place.allow_parking !== false)
    .map((place) => ({
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      icon: place.icon,
      slots: slotsByPlace.get(place.id) ?? [],
    }));
  return NextResponse.json({ places });
}
