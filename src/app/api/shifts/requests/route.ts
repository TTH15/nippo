import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadDriverRule } from "@/server/shiftDeadline/config";
import { loadDriverSlots } from "@/server/shiftSlots/config";
import { monthPeriods } from "@/lib/shiftDeadline";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// GET: 自分の希望休一覧（便付き）＋ 自分が使う便
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
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
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

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
        loadDriverRule(supabase, user.driverId),
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
      const finalRows: { driver_id: string; request_date: string; request_type: string; slot_id: string | null }[] = [];
      for (const [d, set] of byDate) {
        const slotIds = set.has(null) ? [null] : [...set]; // 全休が含まれれば全休のみ
        for (const slotId of slotIds) {
          finalRows.push({ driver_id: user.driverId, request_date: d, request_type: "OFF", slot_id: slotId });
        }
      }

      // 締切済み期間に入らない既存行を削除 → 入れ直し。
      const { data: existing, error: exErr } = await supabase
        .from("shift_requests")
        .select("request_date")
        .eq("driver_id", user.driverId)
        .gte("request_date", monthStart)
        .lte("request_date", monthEnd);
      if (exErr) throw exErr;
      const toDelete = (existing ?? []).map((e) => String(e.request_date)).filter((d) => !inClosed(d));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from("shift_requests")
          .delete()
          .eq("driver_id", user.driverId)
          .in("request_date", toDelete);
        if (delErr) throw delErr;
      }
      if (finalRows.length > 0) {
        const { error: insErr } = await supabase.from("shift_requests").insert(finalRows);
        if (insErr) throw insErr;
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
      const rule = await loadDriverRule(supabase, user.driverId);
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
