import { NextRequest, NextResponse } from "next/server";
import { requireScopedPermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadDriverRule } from "@/server/shiftDeadline/config";
import { loadDriverSlots } from "@/server/shiftSlots/config";
import { monthPeriods } from "@/lib/shiftDeadline";
import { todayJST } from "@/lib/date";
import { diffShiftRequests, type ExistingReq } from "@/server/shiftRequests/diff";
import { insertShiftRequestLogs, fetchActorName, type ShiftLogRow } from "@/server/shiftRequests/log";

export const dynamic = "force-dynamic";

// GET: 自分の希望休一覧（便付き）＋ 自分が使う便
export async function GET(req: NextRequest) {
  // own スコープ移行(§2-6): 対象は常に本人（ownerDriverId 省略 = 本人）。
  const user = await requireScopedPermission(req, {
    own: "own_manage_shift_requests",
    any: "can_view_shifts",
  });
  if (isAuthError(user)) return user;

  const month = req.nextUrl.searchParams.get("month");

  let query = supabase
    .from("shift_requests")
    .select("id, driver_id, request_date, request_type, slot_id")
    .eq("driver_id", user.driverId)
    .order("request_date");

  if (month) {
    const [year, mon] = month.split("-").map(Number);
    const startDate = `${month}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;
    query = query.gte("request_date", startDate).lte("request_date", endDate);
  }

  const [{ data, error }, slots] = await Promise.all([query, loadDriverSlots(supabase, user.driverId)]);
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ requests: data, slots });
}

type OffEntry = { date: string; slotId: string | null };

// POST: 希望休の一括登録（month + offEntries[/offDates]）または単体（date + isOff）
export async function POST(req: NextRequest) {
  // own スコープ移行(§2-6): 書き込み対象は本人の希望休のみ。
  // ハコ虎AI が代行する場合も「委任元本人の own_manage_shift_requests」で同じ判定を通す。
  // 他人の希望休は any（can_manage_shifts）を持つ運営のみ（管理画面の別ルート）。
  const user = await requireScopedPermission(req, {
    own: "own_manage_shift_requests",
    any: "can_manage_shifts",
  });
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const { date, isOff, month, offDates, offEntries } = body;

    // 一括提出。締切済み期間だけ保護し、それ以外を置換。
    if (month && (Array.isArray(offEntries) || Array.isArray(offDates))) {
      const [year, mon] = String(month).split("-").map(Number);
      if (!year || !mon) {
        return NextResponse.json({ error: "invalid month" }, { status: 400 });
      }

      const [rule, mySlots] = await Promise.all([
        loadDriverRule(supabase, orgId, user.driverId),
        loadDriverSlots(supabase, user.driverId),
      ]);
      const validSlotIds = new Set(mySlots.map((s) => s.id));
      const periods = monthPeriods(rule, year, mon, todayJST());
      const closedRanges = periods.filter((p) => p.closed).map((p) => ({ start: p.startDate, end: p.endDate }));
      const inClosed = (d: string) => closedRanges.some((r) => d >= r.start && d <= r.end);

      const monthStart = `${String(month)}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      const monthEnd = `${String(month)}-${String(lastDay).padStart(2, "0")}`;

      // 入力を (date, slotId) に正規化。slot は自分の使う便のみ許可（不正は全休扱いせず破棄）。
      const rawEntries: OffEntry[] = Array.isArray(offEntries)
        ? (offEntries as unknown[])
            .map((e) => e as { date?: unknown; slotId?: unknown })
            .map((e) => ({
              date: typeof e.date === "string" ? e.date : "",
              slotId: typeof e.slotId === "string" ? e.slotId : null,
            }))
        : (offDates as unknown[]).map((d) => ({ date: typeof d === "string" ? d : "", slotId: null }));

      // 日付ごとに重複排除。全休(null)があればその日は全休のみ。
      const byDate = new Map<string, Set<string | null>>();
      for (const e of rawEntries) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
        if (e.date < monthStart || e.date > monthEnd) continue;
        if (inClosed(e.date)) continue; // 締切済みは無視（保護）
        if (e.slotId !== null && !validSlotIds.has(e.slotId)) continue; // 使わない便は破棄
        const set = byDate.get(e.date) ?? new Set<string | null>();
        set.add(e.slotId);
        byDate.set(e.date, set);
      }
      // 希望(desired)を (date, slot) のキー集合に正規化（全休が含まれる日は全休のみ）。
      const desired: { request_date: string; slot_id: string | null }[] = [];
      for (const [d, set] of byDate) {
        const slotIds = set.has(null) ? [null] : [...set];
        for (const slotId of slotIds) desired.push({ request_date: d, slot_id: slotId });
      }

      // 既存行（締切済みは保護＝差分対象外）。差分方式で変更分だけ挿入/削除し、
      // 変更なしの行は触らず created_at（初回提出時刻）を保持する。
      const { data: existingRaw, error: exErr } = await supabase
        .from("shift_requests")
        .select("id, request_date, slot_id")
        .eq("driver_id", user.driverId)
        .gte("request_date", monthStart)
        .lte("request_date", monthEnd);
      if (exErr) throw exErr;
      const existingOpen: ExistingReq[] = (existingRaw ?? [])
        .map((e) => ({ id: String(e.id), request_date: String(e.request_date), slot_id: (e.slot_id as string | null) ?? null }))
        .filter((e) => !inClosed(e.request_date));

      const { toAdd, toRemove } = diffShiftRequests(existingOpen, desired);

      if (toRemove.length > 0) {
        const { error: delErr } = await supabase
          .from("shift_requests")
          .delete()
          .in("id", toRemove.map((r) => r.id));
        if (delErr) throw delErr;
      }
      if (toAdd.length > 0) {
        const { error: insErr } = await supabase.from("shift_requests").insert(
          toAdd.map((r) => ({ driver_id: user.driverId, request_date: r.request_date, request_type: "OFF", slot_id: r.slot_id })),
        );
        if (insErr) throw insErr;
      }

      // 変更履歴を記録（実変更分のみ）。ログ失敗は本処理を妨げない。
      if (toAdd.length > 0 || toRemove.length > 0) {
        const slotNameById = new Map(mySlots.map((s) => [s.id, s.name]));
        const actorName = await fetchActorName(user.driverId);
        const logs: ShiftLogRow[] = [
          ...toAdd.map((r) => ({
            driver_id: user.driverId,
            request_date: r.request_date,
            slot_id: r.slot_id,
            slot_name: r.slot_id ? slotNameById.get(r.slot_id) ?? null : null,
            action: "add" as const,
            actor_type: "driver" as const,
            actor_id: user.driverId,
            actor_name: actorName,
          })),
          ...toRemove.map((r) => ({
            driver_id: user.driverId,
            request_date: r.request_date,
            slot_id: r.slot_id,
            slot_name: r.slot_id ? slotNameById.get(r.slot_id) ?? null : null,
            action: "remove" as const,
            actor_type: "driver" as const,
            actor_id: user.driverId,
            actor_name: actorName,
          })),
        ];
        await insertShiftRequestLogs(logs);
      }
      return NextResponse.json({ ok: true });
    }

    // 単体（後方互換・全休のみ）。
    if (!date) {
      return NextResponse.json({ error: "date or (month+offEntries) required" }, { status: 400 });
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "invalid date" }, { status: 400 });
    }
    {
      const [year, mon] = date.split("-").map(Number);
      const rule = await loadDriverRule(supabase, orgId, user.driverId);
      const periods = monthPeriods(rule, year, mon, todayJST());
      const period = periods.find((p) => date >= p.startDate && date <= p.endDate);
      if (period?.closed) {
        return NextResponse.json(
          { error: "この期間の希望休は締切を過ぎているため変更できません。" },
          { status: 422 },
        );
      }
    }
    if (isOff) {
      const { error } = await supabase
        .from("shift_requests")
        .insert({ driver_id: user.driverId, request_date: date, request_type: "OFF", slot_id: null });
      if (error && error.code !== "23505") throw error; // 既存(全休)は無視
    } else {
      const { error } = await supabase
        .from("shift_requests")
        .delete()
        .eq("driver_id", user.driverId)
        .eq("request_date", date)
        .is("slot_id", null);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
