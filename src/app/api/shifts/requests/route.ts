import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

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
    // 翌月の1日の前日 = 当月末日
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

    // 一括提出: month + offDates で当月の希望休をまとめて更新
    if (month && Array.isArray(offDates)) {
      const [year, mon] = String(month).split("-").map(Number);
      if (!year || !mon) {
        return NextResponse.json({ error: "invalid month" }, { status: 400 });
      }
      const startDate = `${month}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

      // 当月分を削除
      const { error: delErr } = await supabase
        .from("shift_requests")
        .delete()
        .eq("driver_id", user.driverId)
        .gte("request_date", startDate)
        .lte("request_date", endDate);

      if (delErr) throw delErr;

      // 希望休日を登録
      const validDates = offDates.filter(
        (d: unknown) =>
          typeof d === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(d) &&
          d >= startDate &&
          d <= endDate
      );
      if (validDates.length > 0) {
        const rows = validDates.map((d: string) => ({
          driver_id: user.driverId,
          request_date: d,
          request_type: "OFF",
        }));
        const { error: insErr } = await supabase
          .from("shift_requests")
          .insert(rows);

        if (insErr) throw insErr;
      }

      return NextResponse.json({ ok: true });
    }

    // 単体: date + isOff（後方互換）
    if (!date) {
      return NextResponse.json({ error: "date or (month+offDates) required" }, { status: 400 });
    }

    if (isOff) {
      const { error } = await supabase
        .from("shift_requests")
        .upsert(
          {
            driver_id: user.driverId,
            request_date: date,
            request_type: "OFF",
          },
          { onConflict: "driver_id,request_date" }
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
