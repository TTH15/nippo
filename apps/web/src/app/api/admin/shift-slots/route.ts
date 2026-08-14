import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireAnyPermission, isAuthError } from "@/server/auth";
import { SHIFT_SLOTS_VIEW_CAPS } from "@/server/auth/domainCaps";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadAllSlots, saveSlots, type SlotInput } from "@/server/shiftSlots/config";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET: 便一覧 + ドライバー一覧
export async function GET(req: NextRequest) {
  // 便はシフト表のほか、コース編集の便セレクタ（設定領域）からも読む（domainCaps 参照）
  const user = await requireAnyPermission(req, SHIFT_SLOTS_VIEW_CAPS);
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const [slots, { data: drivers }] = await Promise.all([
    loadAllSlots(supabase),
    // org を絞らないと他社のドライバーが便の割当候補に出てしまう
    supabase
      .from("drivers")
      .select("id, name, display_name")
      .eq("org_id", orgId)
      .eq("works_as_driver", true)
      .order("name"),
  ]);
  return NextResponse.json({ slots, drivers: drivers ?? [] });
}

// PUT: 便マスタ＋割り当てを保存
export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const rawSlots = Array.isArray(body.slots) ? body.slots : [];

  // "HH:MM"（or "HH:MM:SS"）のみ許可。それ以外は null。
  const toTime = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? t : null;
  };

  const slots: SlotInput[] = [];
  const seenNames = new Set<string>();
  for (const s of rawSlots as Record<string, unknown>[]) {
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name || seenNames.has(name)) continue; // 名称必須・重複不可（UNIQUE と整合）
    seenNames.add(name);
    const id = typeof s.id === "string" && UUID_RE.test(s.id) ? s.id : null;
    const driverIds = (Array.isArray(s.driverIds) ? s.driverIds : []).filter(
      (d): d is string => typeof d === "string" && UUID_RE.test(d),
    );
    let startTime = toTime(s.startTime);
    let endTime = toTime(s.endTime);
    // 両方ありで start>=end は不正として時刻を捨てる（日跨ぎ非対応）。
    if (startTime && endTime && startTime >= endTime) {
      startTime = null;
      endTime = null;
    }
    slots.push({ id, name, startTime, endTime, active: s.active !== false, driverIds });
  }

  try {
    await saveSlots(supabase, slots);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "保存に失敗しました（migration 076 未適用の可能性）" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
