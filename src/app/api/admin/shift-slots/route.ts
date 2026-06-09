import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAllSlots, saveSlots, type SlotInput } from "@/server/shiftSlots/config";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET: 便一覧 + ドライバー一覧 + キャリア一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const [slots, { data: drivers }, { data: carriers }] = await Promise.all([
    loadAllSlots(supabase),
    supabase.from("drivers").select("id, name, display_name").eq("role", "DRIVER").order("name"),
    supabase.from("carriers").select("id, name").eq("active", true).order("sort_order"),
  ]);
  return NextResponse.json({ slots, drivers: drivers ?? [], carriers: carriers ?? [] });
}

// PUT: 便マスタ＋割り当てを保存
export async function PUT(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const rawSlots = Array.isArray(body.slots) ? body.slots : [];

  const slots: SlotInput[] = [];
  for (const s of rawSlots as Record<string, unknown>[]) {
    const carrierId = typeof s.carrierId === "string" ? s.carrierId : "";
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!UUID_RE.test(carrierId) || !name) continue; // キャリア・名称必須
    const id = typeof s.id === "string" && UUID_RE.test(s.id) ? s.id : null;
    const driverIds = (Array.isArray(s.driverIds) ? s.driverIds : []).filter(
      (d): d is string => typeof d === "string" && UUID_RE.test(d),
    );
    slots.push({ id, carrierId, name, active: s.active !== false, driverIds });
  }

  try {
    await saveSlots(supabase, slots);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "保存に失敗しました（migration 076 未適用の可能性）" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
