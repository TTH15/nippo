import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { logShiftChange } from "@/server/shiftLog";

export const dynamic = "force-dynamic";

// GET: 指定期間のシフト取得
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const startDate = req.nextUrl.searchParams.get("start");
  const endDate = req.nextUrl.searchParams.get("end");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }

  // countDrivers=1: ダッシュボード「本日の稼働数」用の軽量モード。
  // 全体GET（コース/車両/名簿/希望休まで同梱）を件数のためだけに転送しない（2026-08 監査）。
  if (req.nextUrl.searchParams.get("countDrivers") === "1") {
    const [{ data: shiftRows, error: sErr }, { data: orgDrivers, error: dErr }] = await Promise.all([
      supabase
        .from("shifts")
        .select("driver_id")
        .gte("shift_date", startDate)
        .lte("shift_date", endDate)
        .not("driver_id", "is", null),
      // shifts は org 列を持たないため、org のドライバー集合で絞る
      supabase.from("drivers").select("id").eq("org_id", orgId).eq("works_as_driver", true),
    ]);
    if (sErr || dErr) {
      console.error(sErr || dErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    const orgIds = new Set((orgDrivers ?? []).map((d: { id: string }) => d.id));
    const unique = new Set(
      (shiftRows ?? [])
        .map((s: { driver_id: string | null }) => s.driver_id)
        .filter((id): id is string => !!id && orgIds.has(id)),
    );
    return NextResponse.json({ count: unique.size });
  }

  // Get courses
  const { data: courses } = await supabase
    .from("courses")
    .select("*")
    .eq("org_id", orgId)
    .order("sort_order");

  const { data: fleet } = await supabase
    .from("vehicles")
    .select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage, is_ev, last_oil_change_mileage, oil_change_interval")
    .eq("owner_org_id", orgId)
    .eq("is_disposed", false)
    .order("manufacturer")
    .order("brand");

  const fleetById = new Map((fleet ?? []).map((v) => [v.id, v]));

  // Get shifts（vehicle_id は fleet と結合して返す／ネスト名の都合を避ける）
  const { data: shiftsRaw } = await supabase
    .from("shifts")
    .select(
      `
      id, shift_date, course_id, slot, driver_id, vehicle_id, uses_external_vehicle,
      meeting_place, meeting_time, arrival_time, end_time,
      drivers (id, name, display_name)
    `,
    )
    .gte("shift_date", startDate)
    .lte("shift_date", endDate);

  const shifts =
    shiftsRaw?.map((s) => ({
      ...s,
      vehicles:
        "vehicle_id" in s && s.vehicle_id ? (fleetById.get(s.vehicle_id as string) ?? null) : null,
    })) ?? [];

  const { data: vehicleLinks } = await supabase.from("vehicle_drivers").select("driver_id, vehicle_id");

  // 期間内の車両貸出中（その日付は紐付け不可）
  const { data: vehicleLoans } = await supabase
    .from("vehicle_loans")
    .select("vehicle_id, loan_date, note")
    .gte("loan_date", startDate)
    .lte("loan_date", endDate);

  // Get drivers with their course assignments
  // 並びはドライバー名簿と同じ list_no（No.）順に揃える。未設定は末尾、同値は名前順。
  const { data: drivers } = await supabase
    .from("drivers")
    .select(`
      id, name, display_name, role, list_no,
      driver_identities (
        driver_courses (course_id)
      )
    `)
    .eq("org_id", orgId)
    .eq("works_as_driver", true)
    .eq("status", "active")
    .order("list_no", { ascending: true, nullsFirst: false })
    .order("name");

  // Get shift requests (希望休)。slot_id（便。NULL=全休）も含む。
  const { data: requests } = await supabase
    .from("shift_requests")
    .select("*")
    .gte("request_date", startDate)
    .lte("request_date", endDate);

  // 便（時間帯）マスタ（active のみ）。希望休の便名表示用。
  const { data: slots } = await supabase
    .from("shift_request_slots")
    .select("id, name, start_time, end_time")
    .eq("active", true)
    .order("sort_order");

  // 「＋コース」チップの並び順用: 表示期間より前35日の割当実績（ドライバー×コースの頻度・最終日を
  // クライアントで集計し、「よく入るコース」を先頭に出す）。期間内の実績は shifts から取れる。
  const recentStart = (() => {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 35);
    return d.toISOString().slice(0, 10);
  })();
  const { data: recentAssignments } = await supabase
    .from("shifts")
    .select("driver_id, course_id, shift_date")
    .gte("shift_date", recentStart)
    .lt("shift_date", startDate)
    .not("driver_id", "is", null);

  return NextResponse.json({
    courses: courses ?? [],
    shifts: shifts ?? [],
    drivers: drivers ?? [],
    requests: requests ?? [],
    slots: slots ?? [],
    vehicles: fleet ?? [],
    vehicle_driver_links: vehicleLinks ?? [],
    vehicle_loans: vehicleLoans ?? [],
    recent_assignments: recentAssignments ?? [],
  });
}

// POST: シフト登録/更新
// 車両割当は独立エンドポイント /api/admin/shifts/vehicle（can_dispatch）に分離（A1）。
// ここではドライバー割当のみを扱い、割当解除時だけ車両も連動クリアする。
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { shiftDate, courseId, driverId, slot } = body as {
      shiftDate?: string;
      courseId?: string;
      driverId?: string | null;
      slot?: number;
    };

    if (!shiftDate || !courseId) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    const slotNumber = Number.isFinite(slot) && Number(slot) >= 1 ? Math.floor(Number(slot)) : 1;

    // 変更ログ用に変更前の割当を読む（軽い1読取。ログ自体はベストエフォート）。
    const { data: prevRow } = await supabase
      .from("shifts")
      .select("driver_id")
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("slot", slotNumber)
      .maybeSingle();

    const upsertRow: Record<string, unknown> = {
      shift_date: shiftDate,
      course_id: courseId,
      slot: slotNumber,
      driver_id: driverId || null,
      updated_at: new Date().toISOString(),
    };
    // ドライバーを外した行に車両だけ残ると配車表示が浮くため連動クリア。
    if (!driverId) {
      upsertRow.vehicle_id = null;
      upsertRow.uses_external_vehicle = false;
    }

    // Upsert
    const { data, error } = await supabase
      .from("shifts")
      // cycle_no は便（migration 136）。便を使わないコースは 0 のままで従来と同じ挙動
      .upsert(upsertRow, { onConflict: "shift_date,course_id,cycle_no,slot" })
      .select()
      .single();

    if (error) throw error;

    if ((prevRow?.driver_id ?? null) !== (driverId || null)) {
      void logShiftChange({
        orgId: user.orgId,
        actorDriverId: user.driverId,
        action: driverId ? "assign_driver" : "clear_driver",
        shiftDate,
        courseId,
        slot: slotNumber,
        before: { driverId: prevRow?.driver_id ?? null },
        after: { driverId: driverId || null },
      });
    }

    return NextResponse.json({ shift: data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
