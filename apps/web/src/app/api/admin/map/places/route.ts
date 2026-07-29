import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const ICONS = ["pin", "warehouse", "parking", "client"] as const;

// GET: 地図（ベータ）の拠点ピン一覧。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data, error } = await supabase
    .from("map_places")
    .select("id, name, lat, lng, icon")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[map/places] list error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ places: data ?? [] });
}

// POST: 拠点ピンを追加 { name, lat, lng, icon }
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  let body: { name?: string; lat?: number; lng?: number; icon?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name || name.length > 50) {
    return NextResponse.json({ error: "名称は1〜50文字で入力してください" }, { status: 400 });
  }
  const { lat, lng } = body;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return NextResponse.json({ error: "座標が不正です" }, { status: 400 });
  }
  const icon = ICONS.includes(body.icon as (typeof ICONS)[number]) ? body.icon : "pin";

  const { data, error } = await supabase
    .from("map_places")
    .insert({ org_id: orgId, name, lat, lng, icon })
    .select("id, name, lat, lng, icon")
    .single();

  if (error) {
    console.error("[map/places] insert error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ place: data });
}
