import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 希望休の「便（時間帯）」設定アクセス（migration 076）。
//   便マスタ（キャリア別）＋ ドライバー割り当て。テーブル未作成でも空で安全に動く。
// ============================================================

export type RequestSlot = {
  id: string;
  name: string;
  startTime: string | null;
  endTime: string | null;
  sortOrder: number;
  active: boolean;
};
export type SlotFull = RequestSlot & {
  driverIds: string[];
  /** 便を作った会社。null = 持ち主不明の共有便（migration 179 未適用なら undefined） */
  ownerOrgId?: string | null;
  /** この会社が名前・時刻・削除を変えてよいか。閲覧と自社ドライバーへの割当は常に可 */
  editable: boolean;
};
export type SlotInput = {
  id: string | null;
  name: string;
  startTime: string | null;
  endTime: string | null;
  active: boolean;
  driverIds: string[];
};
/** ドライバーが使う便（画面表示用）。 */
export type DriverSlot = { id: string; name: string; startTime: string | null; endTime: string | null };

/** "" や undefined を null へ。"HH:MM" / "HH:MM:SS" はそのまま。 */
const timeOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? t : null;
};

/** あるドライバーが使う便（active のみ・並び順）。未割り当てなら空＝全休のみ。 */
export async function loadDriverSlots(supabase: SupabaseClient, driverId: string): Promise<DriverSlot[]> {
  try {
    const { data: asg } = await supabase
      // tenant-scope-ok: 呼び出し元が本人（user.driverId）または自社のドライバーを渡す
      .from("driver_request_slots")
      .select("slot_id")
      .eq("driver_id", driverId);
    const ids = (asg ?? []).map((r) => String(r.slot_id));
    if (ids.length === 0) return [];
    const { data: slots } = await supabase
      // tenant-scope-ok: ids は本人に割り当てられた便だけ（直上の driver_request_slots 由来）
      .from("shift_request_slots")
      .select("id, name, start_time, end_time")
      .in("id", ids)
      .eq("active", true)
      .order("sort_order");
    return (slots ?? []).map((s) => ({
      id: String(s.id),
      name: s.name ?? "",
      startTime: timeOrNull(s.start_time),
      endTime: timeOrNull(s.end_time),
    }));
  } catch {
    return [];
  }
}

/** 便マスタを読む。migration 179 未適用（owner_org_id 無し）でも動くよう退避する。 */
async function selectSlots(supabase: SupabaseClient) {
  const withOwner = await supabase
    // tenant-scope-ok: 便は共有マスタ。元請→下請へ設定が伝わる構造を保つため全社で見える（編集は owner_org_id の会社だけ）
    .from("shift_request_slots")
    .select("id, name, start_time, end_time, sort_order, active, owner_org_id")
    .order("sort_order");
  if (!withOwner.error) return { rows: withOwner.data ?? [], ownerSupported: true as const };
  const legacy = await supabase
    // tenant-scope-ok: 便は共有マスタ。元請→下請へ設定が伝わる構造を保つため全社で見える（編集は owner_org_id の会社だけ）
    .from("shift_request_slots")
    .select("id, name, start_time, end_time, sort_order, active")
    .order("sort_order");
  return { rows: legacy.data ?? [], ownerSupported: false as const };
}

/**
 * 全便（管理画面用、割り当てドライバーID付き）。
 *
 * ★shift_request_slots は org 列を持たない**共有マスタ**（2026-09-19 時点で3件）。
 *   元請→下請へ設定が伝わる構造を保つため、**便そのものは全社で見える**まま。
 *   ただし **割り当ては自社のドライバーのぶんだけ**返す（絞らないと他社のドライバーIDが出る）。
 *   名前・時刻・削除を変えてよいのは作った会社だけ（`editable`）。
 */
export async function loadAllSlots(supabase: SupabaseClient, orgId: string): Promise<SlotFull[]> {
  try {
    const { data: orgDrivers } = await supabase
      .from("drivers")
      .select("id")
      .eq("org_id", orgId);
    const orgDriverIds = (orgDrivers ?? []).map((d) => String(d.id));
    const [{ rows: slots, ownerSupported }, { data: asg }] = await Promise.all([
      selectSlots(supabase),
      // tenant-scope-ok: orgDriverIds は自社の drivers（.eq("org_id", orgId)）から作った集合
      orgDriverIds.length
        // tenant-scope-ok: orgDriverIds は自社の drivers（.eq("org_id", orgId)）から作った集合
        ? supabase.from("driver_request_slots").select("driver_id, slot_id").in("driver_id", orgDriverIds)
        : Promise.resolve({ data: [] as { driver_id: string; slot_id: string }[] }),
    ]);
    return (slots ?? []).map((s) => {
      const owner = ownerSupported ? ((s as { owner_org_id?: string | null }).owner_org_id ?? null) : undefined;
      return {
        id: String(s.id),
        name: s.name ?? "",
        startTime: timeOrNull(s.start_time),
        endTime: timeOrNull(s.end_time),
        sortOrder: Number(s.sort_order) || 0,
        active: s.active !== false,
        driverIds: (asg ?? []).filter((a) => a.slot_id === s.id).map((a) => String(a.driver_id)),
        ownerOrgId: owner,
        // 179 未適用のうちは従来どおり全便を編集できる（画面を止めない）
        editable: owner === undefined ? true : owner === orgId,
      };
    });
  } catch {
    return [];
  }
}

/**
 * 便マスタ＋割り当てを保存。
 *
 * ★2026-09-18 の点検で見つかった問題: shift_request_slots は org 列を持たない共有マスタで、
 *   ここは「一覧に無い便を全部消す」「割り当てを全部消す」を **全社横断で**やっていた。
 *   つまり A社が便設定を保存すると B社の便と割り当て（＋CASCADEで B社の希望休）が消える。
 *
 * ★2026-09-19 の方針: 便は**共有のまま**（元請→下請へ設定が伝わる構造を保つ）。
 *   migration 179 で `owner_org_id`（作った会社）を足し、ここでは次の3点だけを守る。
 *     - 名前・時刻・並び順の変更と削除は **持ち主の会社だけ**
 *     - 他社の便・持ち主不明の便は触らない（消えたように見えても残す）
 *     - 割り当ての削除・追加は **自社のドライバーだけ**
 *   179 未適用の環境では持ち主が分からないので、当面の防御
 *   （他社のドライバーが使っていない便のみ削除可）へ落ちる。
 */
export async function saveSlots(supabase: SupabaseClient, orgId: string, slots: SlotInput[]): Promise<void> {
  const now = new Date().toISOString();

  // 既存の便と持ち主。何を触ってよいかはここで決まる。
  const { rows: existingRows, ownerSupported } = await selectSlots(supabase);
  const ownerById = new Map<string, string | null>();
  for (const row of existingRows) {
    ownerById.set(String(row.id), ownerSupported ? ((row as { owner_org_id?: string | null }).owner_org_id ?? null) : null);
  }
  /** 持ち主が自社なら触ってよい。179 未適用（持ち主不明）のうちは従来どおり触れる。 */
  const mayEdit = (slotId: string) => (ownerSupported ? ownerById.get(slotId) === orgId : true);

  // 自社のドライバー集合（割り当ての範囲を自社に閉じるために使う）。
  const { data: orgDrivers } = await supabase.from("drivers").select("id").eq("org_id", orgId);
  const orgDriverIds = (orgDrivers ?? []).map((d) => String(d.id));

  const kept: { slotId: string; driverIds: string[] }[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    let id = s.id;
    if (id) {
      // 他社の便・持ち主不明の便は、割り当てだけ受け付けて中身は変えない。
      if (mayEdit(id)) {
        // tenant-scope-ok: mayEdit で持ち主が自社の便に限っている
        await supabase.from("shift_request_slots").update({
          name: s.name,
          start_time: timeOrNull(s.startTime),
          end_time: timeOrNull(s.endTime),
          sort_order: i,
          active: s.active,
          updated_at: now,
        }).eq("id", id);
      }
    } else {
      const fields: Record<string, unknown> = {
        name: s.name,
        start_time: timeOrNull(s.startTime),
        end_time: timeOrNull(s.endTime),
        sort_order: i,
        active: s.active,
        updated_at: now,
      };
      if (ownerSupported) fields.owner_org_id = orgId;
      // tenant-scope-ok: 新規作成。owner_org_id に認証済みの orgId を入れている（179 適用後）
      const { data } = await supabase.from("shift_request_slots").insert(fields).select("id").single();
      id = (data?.id as string | undefined) ?? null;
    }
    if (!id) continue;
    kept.push({ slotId: id, driverIds: s.driverIds });
  }

  // 画面から消えた便のうち、**自社が作ったもの**だけを削除する（紐づく希望休も CASCADE）。
  const keptIds = new Set(kept.map((k) => k.slotId));
  const removable = [...ownerById.keys()].filter((id) => !keptIds.has(id) && mayEdit(id));
  const deletable = ownerSupported ? removable : await withoutSlotsOtherOrgsUse(supabase, removable, orgDriverIds);
  if (deletable.length > 0) {
    // tenant-scope-ok: deletable は持ち主が自社の便（179 未適用時は他社が使っていない便）だけ
    await supabase.from("shift_request_slots").delete().in("id", deletable);
  }

  // 割り当ては**自社のドライバーぶんだけ**置換する。
  if (orgDriverIds.length > 0) {
    // tenant-scope-ok: orgDriverIds は自社の drivers（.eq("org_id", orgId)）から作った集合
    await supabase.from("driver_request_slots").delete().in("driver_id", orgDriverIds);
  }
  const rows = kept.flatMap((k) =>
    k.driverIds
      .filter((d) => orgDriverIds.includes(d)) // 他社のドライバーを割り当てさせない
      .map((d) => ({ driver_id: d, slot_id: k.slotId, updated_at: now })),
  );
  // tenant-scope-ok: driver_id は直上で自社のドライバーだけに絞り込み済み
  if (rows.length > 0) await supabase.from("driver_request_slots").insert(rows);
}

/** migration 179 未適用のときの退避。他社のドライバーが使っている便を削除候補から外す。 */
async function withoutSlotsOtherOrgsUse(
  supabase: SupabaseClient,
  candidates: string[],
  orgDriverIds: string[],
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const { data } = await supabase
    // tenant-scope-ok: 削除候補の便を他社が使っていないか調べるための問い合わせ（読み取りのみ）
    .from("driver_request_slots")
    .select("slot_id, driver_id")
    .in("slot_id", candidates);
  const usedByOthers = new Set(
    (data ?? []).filter((r) => !orgDriverIds.includes(String(r.driver_id))).map((r) => String(r.slot_id)),
  );
  return candidates.filter((id) => !usedByOthers.has(id));
}
