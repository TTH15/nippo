import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 希望休の「便（時間帯）」設定アクセス（migration 076）。
//   便マスタ（キャリア別）＋ ドライバー割り当て。テーブル未作成でも空で安全に動く。
// ============================================================

export type RequestSlot = { id: string; name: string; sortOrder: number; active: boolean };
export type SlotFull = RequestSlot & { driverIds: string[] };
export type SlotInput = {
  id: string | null;
  name: string;
  active: boolean;
  driverIds: string[];
};
/** ドライバーが使う便（画面表示用）。 */
export type DriverSlot = { id: string; name: string };

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** あるドライバーが使う便（active のみ・並び順）。未割り当てなら空＝全休のみ。 */
export async function loadDriverSlots(supabase: SupabaseClient, driverId: string): Promise<DriverSlot[]> {
  try {
    const { data: asg } = await supabase
      .from("driver_request_slots")
      .select("slot_id")
      .eq("driver_id", driverId);
    const ids = (asg ?? []).map((r) => String(r.slot_id));
    if (ids.length === 0) return [];
    const { data: slots } = await supabase
      .from("shift_request_slots")
      .select("id, name")
      .in("id", ids)
      .eq("active", true)
      .order("sort_order");
    return (slots ?? []).map((s) => ({ id: String(s.id), name: s.name ?? "" }));
  } catch {
    return [];
  }
}

/** 全便（管理画面用、割り当てドライバーID付き）。 */
export async function loadAllSlots(supabase: SupabaseClient): Promise<SlotFull[]> {
  try {
    const [{ data: slots }, { data: asg }] = await Promise.all([
      supabase.from("shift_request_slots").select("id, name, sort_order, active").order("sort_order"),
      supabase.from("driver_request_slots").select("driver_id, slot_id"),
    ]);
    return (slots ?? []).map((s) => ({
      id: String(s.id),
      name: s.name ?? "",
      sortOrder: Number(s.sort_order) || 0,
      active: s.active !== false,
      driverIds: (asg ?? []).filter((a) => a.slot_id === s.id).map((a) => String(a.driver_id)),
    }));
  } catch {
    return [];
  }
}

/**
 * 便マスタ＋割り当てを保存。
 *   便は id を保ったまま upsert（削除された便のみ削除＝紐づく希望休も CASCADE）。
 *   割り当て(driver_request_slots)は全置換。
 */
export async function saveSlots(supabase: SupabaseClient, slots: SlotInput[]): Promise<void> {
  const now = new Date().toISOString();
  const kept: { slotId: string; driverIds: string[] }[] = [];

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    let id = s.id;
    if (id) {
      await supabase
        .from("shift_request_slots")
        .update({ name: s.name, sort_order: i, active: s.active, updated_at: now })
        .eq("id", id);
    } else {
      const { data } = await supabase
        .from("shift_request_slots")
        .insert({ name: s.name, sort_order: i, active: s.active, updated_at: now })
        .select("id")
        .single();
      id = (data?.id as string | undefined) ?? null;
    }
    if (!id) continue;
    kept.push({ slotId: id, driverIds: s.driverIds });
  }

  // 残った便以外を削除（運営が消した便。紐づく希望休も CASCADE で消える）。
  const keptIds = kept.map((k) => k.slotId);
  if (keptIds.length > 0) {
    await supabase.from("shift_request_slots").delete().not("id", "in", `(${keptIds.join(",")})`);
  } else {
    await supabase.from("shift_request_slots").delete().neq("id", ZERO_UUID);
  }

  // 割り当て全置換。
  await supabase.from("driver_request_slots").delete().neq("driver_id", ZERO_UUID);
  const rows = kept.flatMap((k) =>
    k.driverIds.map((d) => ({ driver_id: d, slot_id: k.slotId, updated_at: now })),
  );
  if (rows.length > 0) await supabase.from("driver_request_slots").insert(rows);
}
