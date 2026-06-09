import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadDriverRule } from "@/server/shiftDeadline/config";
import { monthPeriods } from "@/lib/shiftDeadline";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// GET: 自分の希望休一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const month = req.nextUrl.searchParams.get("month");

  let query = supabase
    .from("shift_requests")
    .select("*")
    .eq("driver_id", user.driverId)
    .order("request_date");

  if (month) {
    const [year, mon] = month.split("-").map(Number);
    const startDate = `${month}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;
    query = query.gte("request_date", startDate).lte("request_date", endDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ requests: data });
}

// POST: 希望休の登録/削除（単体）または一括登録（month + offDates）
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { date, isOff, month, offDates } = body;

    // 一括提出: month + offDates。締切判定はサーバで再計算（クライアント値は信用しない）。
    //   ルールの「締切済み(closed)期間」だけ保護。それ以外（開いている期間・どの期間にも属さない日・
    //   未割り当て＝ルールなし）は自由に編集可。
    if (month && Array.isArray(offDates)) {
      const [year, mon] = String(month).split("-").map(Number);
      if (!year || !mon) {
        return NextResponse.json({ error: "invalid month" }, { status: 400 });
      }

      const rule = await loadDriverRule(supabase, user.driverId);
      const periods = monthPeriods(rule, year, mon, todayJST());
      const closedRanges = periods
        .filter((p) => p.closed)
        .map((p) => ({ start: p.startDate, end: p.endDate }));
      const inClosed = (d: string) => closedRanges.some((r) => d >= r.start && d <= r.end);

      const monthStart = `${String(month)}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      const monthEnd = `${String(month)}-${String(lastDay).padStart(2, "0")}`;

      // 既存の当月行のうち、締切済み期間に入らないもの＝編集可 → 一旦削除。
      const { data: existing, error: exErr } = await supabase
        .from("shift_requests")
        .select("request_date")
        .eq("driver_id", user.driverId)
        .gte("request_date", monthStart)
        .lte("request_date", monthEnd);
      if (exErr) throw exErr;
      const toDelete = (existing ?? [])
        .map((e) => String(e.request_date))
        .filter((d) => !inClosed(d));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from("shift_requests")
          .delete()
          .eq("driver_id", user.driverId)
          .in("request_date", toDelete);
        if (delErr) throw delErr;
      }

      // 締切済み期間に入らない希望休日だけ登録（締切済みは黙殺＝保護）。
      const validDates = (offDates as unknown[]).filter(
        (d): d is string =>
          typeof d === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(d) &&
          d >= monthStart &&
          d <= monthEnd &&
          !inClosed(d),
      );
      if (validDates.length > 0) {
        const rows = validDates.map((d) => ({
          driver_id: user.driverId,
          request_date: d,
          request_type: "OFF",
        }));
        const { error: insErr } = await supabase.from("shift_requests").insert(rows);
        if (insErr) throw insErr;
      }

      return NextResponse.json({ ok: true });
    }

    // 単体: date + isOff（後方互換）
    if (!date) {
      return NextResponse.json({ error: "date or (month+offDates) required" }, { status: 400 });
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "invalid date" }, { status: 400 });
    }

    // 締切済み期間の変更は拒否。
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
        .upsert(
          { driver_id: user.driverId, request_date: date, request_type: "OFF" },
          { onConflict: "driver_id,request_date" },
        );
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("shift_requests")
        .delete()
        .eq("driver_id", user.driverId)
        .eq("request_date", date);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
