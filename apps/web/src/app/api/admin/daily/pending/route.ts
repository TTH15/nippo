import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

export const dynamic = "force-dynamic";

type PendingEntry = {
  driver: { id: string; name: string; display_name: string | null };
  report: any;
};

type PendingGroup = {
  date: string; // YYYY-MM-DD
  entries: PendingEntry[];
};

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;

  try {
    // v2 ソース（互換リーダー）→ 未承認かつ未却下のみ。日付降順→送信時刻降順。
    const all = (
      await loadLegacyDailyRows(supabase, {}, { idSource: "v2", withVehicle: true })
    ).sort(
      (a, b) =>
        b.report_date.localeCompare(a.report_date) ||
        String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? "")),
    );
    const rows = all.filter((r) => r.approved_at == null && r.rejected_at == null);
    if (!rows.length) {
      return NextResponse.json({ groups: [], totalPending: 0 });
    }

    // 関連するドライバー情報を一括取得
    const driverIds = Array.from(new Set(rows.map((r: any) => r.driver_id).filter(Boolean)));
    const { data: drivers, error: driverErr } = await supabase
      .from("drivers")
      .select("id, name, display_name")
      .in("id", driverIds);

    if (driverErr) {
      console.error("[admin/daily/pending] drivers error", driverErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const driverMap = new Map<string, { id: string; name: string; display_name: string | null }>();
    (drivers ?? []).forEach((d: any) => {
      driverMap.set(d.id, {
        id: d.id,
        name: d.name,
        display_name: d.display_name ?? null,
      });
    });

    const grouped = new Map<string, PendingEntry[]>();

    rows.forEach((r: any) => {
      const date: string = r.report_date;
      const driver = driverMap.get(r.driver_id);
      if (!driver) return;

      const entry: PendingEntry = {
        driver,
        report: r,
      };

      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date)!.push(entry);
    });

    const groups: PendingGroup[] = Array.from(grouped.entries())
      .sort(([d1], [d2]) => (d1 < d2 ? 1 : d1 > d2 ? -1 : 0)) // 日付降順
      .map(([date, entries]) => ({ date, entries }));

    const totalPending = groups.reduce((sum, g) => sum + g.entries.length, 0);

    return NextResponse.json({
      groups,
      totalPending,
    });
  } catch (err) {
    console.error("[admin/daily/pending] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

