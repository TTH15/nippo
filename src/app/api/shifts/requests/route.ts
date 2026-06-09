import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadDeadlineConfig, loadDeadlineOverrides, loadDriverDeadline } from "@/server/shiftDeadline/config";
import { monthHalves } from "@/lib/shiftDeadline";
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

    // 一括提出: month + offDates で当月の希望休をまとめて更新。
    // 締切ルール: 半月(前半/後半)ごとに締切を再計算し、開いている半月の区間だけ
    //   delete+insert する。締切済み半月の既存行は絶対に触れない（誤って消さない）。
    if (month && Array.isArray(offDates)) {
      const [year, mon] = String(month).split("-").map(Number);
      if (!year || !mon) {
        return NextResponse.json({ error: "invalid month" }, { status: 400 });
      }

      // サーバ側で締切を再計算（クライアント送信値は信用しない）。個別締切も反映。
      const [config, overrides, driver] = await Promise.all([
        loadDeadlineConfig(supabase),
        loadDeadlineOverrides(supabase),
        loadDriverDeadline(supabase, user.driverId),
      ]);
      const { firstHalf, secondHalf } = monthHalves(config, overrides, year, mon, todayJST(), driver);

      // 開いている半月の区間だけを対象にする
      const openRanges: { start: string; end: string }[] = [];
      if (!firstHalf.closed) openRanges.push({ start: firstHalf.startDate, end: firstHalf.endDate });
      if (!secondHalf.closed) openRanges.push({ start: secondHalf.startDate, end: secondHalf.endDate });

      // 両方締切なら何もしない（締切済みデータを守る）
      if (openRanges.length === 0) {
        return NextResponse.json({ ok: true, locked: true });
      }

      // 開区間のみ削除
      for (const { start, end } of openRanges) {
        const { error: delErr } = await supabase
          .from("shift_requests")
          .delete()
          .eq("driver_id", user.driverId)
          .gte("request_date", start)
          .lte("request_date", end);
        if (delErr) throw delErr;
      }

      // 開区間に入る希望休日だけ登録（締切済み半月の日付は黙殺）
      const validDates = (offDates as unknown[]).filter(
        (d): d is string =>
          typeof d === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(d) &&
          openRanges.some((r) => d >= r.start && d <= r.end),
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

    // 締切済み半月の変更は拒否（一括パスと同じ防御）
    {
      const [year, mon, day] = date.split("-").map(Number);
      const [config, overrides, driver] = await Promise.all([
        loadDeadlineConfig(supabase),
        loadDeadlineOverrides(supabase),
        loadDriverDeadline(supabase, user.driverId),
      ]);
      const { firstHalf, secondHalf } = monthHalves(config, overrides, year, mon, todayJST(), driver);
      const target = day <= config.firstHalfEndDay ? firstHalf : secondHalf;
      if (target.closed) {
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
