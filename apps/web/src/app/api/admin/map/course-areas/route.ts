import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 配達エリア（コースの属性・migration 125）。
// 「拠点＝点や円」「配達エリア＝コースが持つ面」という切り分け（2026-08-10 合意）。
//
// GET: 地図に重ねるためのコース一覧（色付き）。エリア未設定のコースも返す
//      （「これから引く対象」として選ばせるため）。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const { data, error } = await supabase
    .from("courses")
    .select("id, name, color, delivery_area, delivery_area_updated_at")
    .eq("org_id", orgId)
    .order("sort_order");

  if (error) {
    // migration 125 未適用でも地図を落とさない（列が無いだけならエリア無しとして扱う）
    console.error("[map/course-areas] list error", error);
    const fallback = await supabase
      .from("courses")
      .select("id, name, color")
      .eq("org_id", orgId)
      .order("sort_order");
    if (fallback.error) return NextResponse.json({ error: "DB error" }, { status: 500 });
    return NextResponse.json({
      courses: (fallback.data ?? []).map((c) => ({ ...c, delivery_area: null, delivery_area_updated_at: null })),
      areasAvailable: false,
    });
  }

  return NextResponse.json({ courses: data ?? [], areasAvailable: true });
}
