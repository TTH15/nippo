import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { reportDateDefaultJST } from "@/lib/date";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";
import { loadReportContents } from "@/server/aggregation/reportContent";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
import { loadPendingDates } from "@/server/daily/pendingDates";

export const dynamic = "force-dynamic";

// 2026-08 監査での構造変更:
// - pending=1 は「要対応が残る日」をまず確定（RPC 優先・migration 133）し、
//   シフト・日報はその日だけ読む（従来は 2020年〜の全履歴を毎回転送していた）
// - report_entries の二重読みを廃止（withEntries:false。表示は loadReportContents の content のみ）
// - drivers はトップレベルに1回だけ返す（従来は日数ぶん複製）。
//   driverPreferredVehicle はクライアント未使用のため廃止。

type VehiclePlatePayload = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

function toPlatePayload(v: any): VehiclePlatePayload | null {
  if (!v || !v.id) return null;
  return {
    id: v.id,
    number_prefix: v.number_prefix ?? null,
    number_class: v.number_class ?? null,
    number_hiragana: v.number_hiragana ?? null,
    number_numeric: v.number_numeric ?? null,
    manufacturer: v.manufacturer ?? null,
    brand: v.brand ?? null,
  };
}

type ShiftRow = { shift_date: string | null; driver_id: string | null; course_id: string | null };

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const url = req.nextUrl;
  let startParam = url.searchParams.get("start");
  let endParam = url.searchParams.get("end");
  const businessToday = reportDateDefaultJST();

  // pending=1: 「要対応（未提出・未承認）」ビュー。期間で切らず全履歴から
  // 要対応が残る日だけを返す（未対応が期間選択で見落とされるのを防ぐ・2026-08-02 決定）。
  // 応答形式は通常モードと同じ days[]。
  const pendingOnly = url.searchParams.get("pending") === "1";
  if (pendingOnly) {
    startParam = "2020-01-01"; // サービス開始より十分前（実データの下限で自然に切れる）
    endParam = businessToday;
  }

  if (!startParam || !endParam) {
    // 「要対応」タブは未解決の日だけが描画対象なので、遡り幅を広げても表示は増えない。
    // 経過日数だけで一覧・バッジから消えてしまわないよう既定の遡り幅は広めに取る。
    const end = businessToday;
    const base = new Date(end + "T12:00:00+09:00");
    const start = new Date(base);
    start.setDate(start.getDate() - 89);
    startParam = start.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    endParam = end;
  }

  // 未来日は対象外にする（指定があっても businessToday までにクランプ）
  if (startParam > businessToday) startParam = businessToday;
  if (endParam > businessToday) endParam = businessToday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startParam) || !/^\d{4}-\d{2}-\d{2}$/.test(endParam)) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (startParam > endParam) {
    [startParam, endParam] = [endParam, startParam];
  }

  try {
    // 名簿・シフトと並び順を揃える（list_no 昇順）。status は画面側の絞り込み用に返す。
    const { data: drivers, error: driversErr } = await supabase
      .from("drivers")
      .select("id, name, display_name, status")
      .eq("org_id", orgId)
      .eq("works_as_driver", true)
      .order("list_no", { ascending: true, nullsFirst: false })
      .order("name");

    if (driversErr) {
      console.error("[admin/daily/day-summary-range] drivers error", driversErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    let dates: string[];
    let shiftRows: ShiftRow[];
    let reportRows: Awaited<ReturnType<typeof loadLegacyDailyRows>>;

    if (pendingOnly) {
      // ① 要対応が残る日を先に確定（RPC 優先＋フォールバック）。今日は常に表示する。
      const pendingDates = await loadPendingDates(supabase, orgId, startParam, endParam);
      const kept = new Set(pendingDates.filter((d) => d <= businessToday));
      kept.add(businessToday);
      dates = Array.from(kept);

      // ② シフト・日報は確定した日だけ読む（IN 句は 200 件ずつ分割）
      shiftRows = [];
      reportRows = [];
      for (let i = 0; i < dates.length; i += IN_CLAUSE_BATCH_SIZE) {
        const slice = dates.slice(i, i + IN_CLAUSE_BATCH_SIZE);
        const [shiftSlice, reportSlice] = await Promise.all([
          fetchAllRows<ShiftRow>((from, to) =>
            supabase
              .from("shifts")
              .select("shift_date, driver_id, course_id")
              .in("shift_date", slice)
              .not("driver_id", "is", null)
              .order("shift_date", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to),
          ),
          loadLegacyDailyRows(
            supabase,
            orgId,
            { dates: slice },
            { idSource: "v2", withVehicle: true, withEntries: false },
          ),
        ]);
        shiftRows.push(...shiftSlice);
        reportRows.push(...reportSlice);
      }
    } else {
      // 半年・1年指定ではシフト行が PostgREST の既定上限(1000行)を超える。
      // 上限で黙って切られると後半の日付のシフトが欠落し「休み」誤表示（未提出の見逃し）
      // になるため、必ずページングで全件取得する（2026-08-02 の不具合）。
      const [shiftsRes, reportsRes] = await Promise.all([
        fetchAllRows<ShiftRow>((from, to) =>
          supabase
            .from("shifts")
            .select("shift_date, driver_id, course_id")
            .gte("shift_date", startParam)
            .lte("shift_date", endParam)
            .not("driver_id", "is", null)
            .order("shift_date", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        ),
        loadLegacyDailyRows(
          supabase,
          orgId,
          { start: startParam, end: endParam },
          { idSource: "v2", withVehicle: true, withEntries: false },
        ),
      ]);
      shiftRows = shiftsRes;
      reportRows = reportsRes;

      dates = [];
      const d = new Date(startParam);
      const end = new Date(endParam);
      while (d <= end) {
        dates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
    }

    // 却下済みは同日に残るため、一覧は「未却下」を優先表示
    reportRows = reportRows.filter((r) => !r.rejected_at);

    const shiftsByDate = new Map<string, Set<string>>();
    // 日付×ドライバーごとの担当コース集合（1日複数コースの未提出検出用）
    const shiftCoursesByDate = new Map<string, Map<string, Set<string>>>();
    (shiftRows ?? []).forEach((r) => {
      if (!r.shift_date || !r.driver_id) return;
      if (!shiftsByDate.has(r.shift_date)) shiftsByDate.set(r.shift_date, new Set());
      shiftsByDate.get(r.shift_date)!.add(r.driver_id);
      if (!r.course_id) return;
      if (!shiftCoursesByDate.has(r.shift_date)) shiftCoursesByDate.set(r.shift_date, new Map());
      const byDriver = shiftCoursesByDate.get(r.shift_date)!;
      if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, new Set());
      byDriver.get(r.driver_id)!.add(r.course_id);
    });

    // 内容（送信画面と同じ動的 unit/field 構造）を report_entries から取得
    const contentByReport = await loadReportContents(
      supabase,
      (reportRows ?? []).map((r: any) => r.id).filter(Boolean),
    );

    const reportsByDateDriver = new Map<string, Map<string, any>>();
    (reportRows ?? []).forEach((r: any) => {
      const date = r.report_date;
      const driverId = r.driver_id;
      if (!date || !driverId) return;
      if (!reportsByDateDriver.has(date)) reportsByDateDriver.set(date, new Map());
      const veh = r.vehicles;
      // 1日複数シフト（複数コース）対応: ドライバーごとに配列で保持
      const arr = reportsByDateDriver.get(date)!.get(driverId) ?? [];
      arr.push({
        id: r.id,
        driver_id: r.driver_id,
        report_date: r.report_date,
        course_id: r.course_id ?? null,
        course_name: r.course_name ?? null,
        content: contentByReport.get(r.id) ?? [],
        // 旧数値カラムは互換のため残すが、表示は content が正（withEntries:false のため常に0）
        takuhaibin_completed: Number(r.takuhaibin_completed) || 0,
        takuhaibin_returned: Number(r.takuhaibin_returned) || 0,
        nekopos_completed: Number(r.nekopos_completed) || 0,
        nekopos_returned: Number(r.nekopos_returned) || 0,
        submitted_at: r.submitted_at ?? "",
        carrier: r.carrier ?? null,
        carrier_id: r.carrier_id ?? null,
        carrier_name: r.carrier_name ?? null,
        approved_at: r.approved_at ?? null,
        rejected_at: r.rejected_at ?? null,
        vehicle_id: r.vehicle_id ?? null,
        meter_value: r.meter_value != null ? Number(r.meter_value) : null,
        vehicle_plate: toPlatePayload(veh),
      });
      reportsByDateDriver.get(date)!.set(driverId, arr);
    });

    dates.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

    const days = dates.map((date) => {
      const shiftDriverIds = Array.from(shiftsByDate.get(date) ?? []);
      const reportsMap = reportsByDateDriver.get(date) ?? new Map();
      const reportsByDriver: Record<string, any> = {};
      reportsMap.forEach((v, k) => {
        reportsByDriver[k] = v;
      });
      const shiftCoursesByDriver: Record<string, string[]> = {};
      (shiftCoursesByDate.get(date) ?? new Map<string, Set<string>>()).forEach((courseSet, driverId) => {
        shiftCoursesByDriver[driverId] = Array.from(courseSet);
      });
      return {
        date,
        shiftDriverIds,
        shiftCoursesByDriver,
        reportsByDriver,
      };
    });

    // drivers は全日で共通のためトップレベルに1回だけ返す（ペイロードの二次膨張防止）
    return NextResponse.json({ days, drivers: drivers ?? [] });
  } catch (err) {
    console.error("[admin/daily/day-summary-range] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
