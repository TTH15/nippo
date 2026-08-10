import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PATCH: 区画名・定位置の車両・形状の変更 / DELETE: 区画の削除。
// 形状を変えたら向き（bearing）と代表点も引き直す（人には触らせない）。

type Ring = [number, number][];

function bearingFromRect(ring: Ring): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const dx = (b[0] - a[0]) * Math.cos(lat);
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      best = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    }
  }
  return best;
}

function readRing(geometry: unknown): Ring | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g || g.type !== "Polygon" || !Array.isArray(g.coordinates)) return null;
  const ring = g.coordinates[0] as Ring | undefined;
  if (!Array.isArray(ring) || ring.length < 4) return null;
  return ring;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body?.label === "string") {
    const label = body.label.trim();
    if (!label || label.length > 20) {
      return NextResponse.json({ error: "区画名は1〜20文字で入力してください" }, { status: 400 });
    }
    updates.label = label;
  }
  if (body?.vehicleId !== undefined) {
    updates.vehicle_id = body.vehicleId || null;
  }
  if (body?.geometry !== undefined) {
    const ring = readRing(body.geometry);
    if (!ring) return NextResponse.json({ error: "区画の形が正しくありません" }, { status: 400 });
    const pts = ring.slice(0, -1);
    updates.geometry = body.geometry;
    updates.bearing = bearingFromRect(ring);
    updates.lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    updates.lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  }

  const { data, error } = await supabase
    .from("parking_slots")
    .update(updates)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id, place_id, label, geometry, bearing, lat, lng, vehicle_id")
    .maybeSingle();

  if (error) {
    console.error("[parking-slots] update error", error);
    if (error.code === "23505") {
      return NextResponse.json({ error: "その車両は既に別の区画に割り当てられています" }, { status: 400 });
    }
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "区画が見つかりません" }, { status: 404 });
  return NextResponse.json({ slot: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id } = await params;

  const { error } = await supabase.from("parking_slots").delete().eq("id", id).eq("org_id", orgId);
  if (error) {
    console.error("[parking-slots] delete error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
