import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// org の車体色パレット（migration 127）。
// 白・グレー・黒は既定で持つのでここには入れない。
// 一度使った色を貯めて、次回から選ぶだけにするための仕組み。
// ============================================================

const HEX = /^#[0-9a-fA-F]{6}$/;
/** パレットが際限なく伸びると選びにくくなるので上限を設ける */
const MAX_COLORS = 12;

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const { data, error } = await supabase
    .from("organizations")
    .select("vehicle_body_colors")
    .eq("id", orgId)
    .maybeSingle();

  if (error) {
    // migration 127 未適用でも車両画面を落とさない
    console.error("[org/vehicle-colors] list error", error);
    return NextResponse.json({ colors: [] });
  }
  return NextResponse.json({ colors: (data?.vehicle_body_colors as string[] | null) ?? [] });
}

/** POST: 色をパレットへ追加する（重複は無視）。車両の保存時に呼ぶ。 */
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => null);
  const color = typeof body?.color === "string" ? body.color.toLowerCase() : "";
  if (!HEX.test(color)) {
    return NextResponse.json({ error: "色の形式が正しくありません" }, { status: 400 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("vehicle_body_colors")
    .eq("id", orgId)
    .maybeSingle();
  const current = ((org?.vehicle_body_colors as string[] | null) ?? []).map((c) => c.toLowerCase());
  if (current.includes(color)) return NextResponse.json({ colors: current });

  // 新しい色を先頭に置く（直近に使った色ほど再び使われやすい）
  const next = [color, ...current].slice(0, MAX_COLORS);
  const { error } = await supabase
    .from("organizations")
    .update({ vehicle_body_colors: next })
    .eq("id", orgId);
  if (error) {
    console.error("[org/vehicle-colors] update error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ colors: next });
}

/** DELETE: パレットから色を外す（?color=%23aabbcc）。 */
export async function DELETE(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const color = (req.nextUrl.searchParams.get("color") ?? "").toLowerCase();
  if (!HEX.test(color)) return NextResponse.json({ error: "色の形式が正しくありません" }, { status: 400 });

  const { data: org } = await supabase
    .from("organizations")
    .select("vehicle_body_colors")
    .eq("id", orgId)
    .maybeSingle();
  const next = ((org?.vehicle_body_colors as string[] | null) ?? []).filter(
    (c) => c.toLowerCase() !== color,
  );
  await supabase.from("organizations").update({ vehicle_body_colors: next }).eq("id", orgId);
  return NextResponse.json({ colors: next });
}
