import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const ICONS = ["pin", "warehouse", "parking", "client", "fuel"] as const;

// PATCH: 拠点の編集（名称・種別・位置・範囲）。
// 一度置いたら直せないのは実用に耐えないため（2026-08-10 要望）。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  let body: { name?: string; lat?: number; lng?: number; icon?: string; radiusM?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = (body.name ?? "").trim();
    if (!name || name.length > 50) {
      return NextResponse.json({ error: "名称は1〜50文字で入力してください" }, { status: 400 });
    }
    updates.name = name;
  }
  if (body.icon !== undefined && ICONS.includes(body.icon as (typeof ICONS)[number])) {
    updates.icon = body.icon;
  }
  if (body.lat !== undefined || body.lng !== undefined) {
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
    updates.lat = lat;
    updates.lng = lng;
  }
  if (body.radiusM !== undefined) {
    const n = Number(body.radiusM);
    const radius = !Number.isFinite(n) || n < 10 ? null : Math.min(Math.round(n), 5000);
    updates.radius_m = radius;
    updates.shape = radius ? "circle" : "point";
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "変更内容がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("map_places")
    .update(updates)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id, name, lat, lng, icon, shape, radius_m")
    .maybeSingle();

  if (error) {
    console.error("[map/places] update error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });
  return NextResponse.json({ place: data });
}

// DELETE: 拠点ピンを削除（自テナントのもののみ）。
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { error } = await supabase.from("map_places").delete().eq("id", id).eq("org_id", orgId);

  if (error) {
    console.error("[map/places] delete error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
