import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// PUT: コースの配達エリアを保存する（GeoJSON Polygon / MultiPolygon）。
// DELETE: 配達エリアを消す（コース自体は消さない）。
//
// エリアはコースの属性（migration 125）。誰がいつ引いたかを残す
//（区域の線引きは揉めやすいので、後から辿れるようにしておく）。
// ============================================================

/** 受け取った GeoJSON が Polygon / MultiPolygon として妥当かを最低限確かめる。 */
function validArea(v: unknown): v is { type: "Polygon" | "MultiPolygon"; coordinates: unknown[] } {
  if (!v || typeof v !== "object") return false;
  const g = v as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return false;
  if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return false;
  // 頂点が3点未満の «面» は面として意味を成さない
  const ring = g.type === "Polygon" ? g.coordinates[0] : (g.coordinates[0] as unknown[])?.[0];
  return Array.isArray(ring) && ring.length >= 4; // 閉じた環なので最低4点（始点=終点）
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_courses");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!validArea(body?.area)) {
    return NextResponse.json({ error: "エリアの形が正しくありません（3点以上で囲ってください）" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("courses")
    .update({
      delivery_area: body.area,
      delivery_area_updated_at: new Date().toISOString(),
      delivery_area_updated_by: user.driverId,
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id, name, color, delivery_area, delivery_area_updated_at")
    .maybeSingle();

  if (error) {
    console.error("[map/course-areas] update error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });
  return NextResponse.json({ course: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_courses");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id } = await params;

  const { error } = await supabase
    .from("courses")
    .update({
      delivery_area: null,
      delivery_area_updated_at: new Date().toISOString(),
      delivery_area_updated_by: user.driverId,
    })
    .eq("id", id)
    .eq("org_id", orgId);

  if (error) {
    console.error("[map/course-areas] delete error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
