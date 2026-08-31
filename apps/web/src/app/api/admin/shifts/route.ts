import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { adminMutationError, belongsToOrg, isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import { logShiftChange } from "@/server/shiftLog";

export const dynamic = "force-dynamic";

// GET: 指定期間のシフト取得
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  try {
    const orgId = user.orgId ?? await resolveOrgId(user.driverId);
    const startDate = req.nextUrl.searchParams.get("start");
    const endDate = req.nextUrl.searchParams.get("end");
    if (!isDateOnly(startDate) || !isDateOnly(endDate) || startDate > endDate) {
      return NextResponse.json({ error: "有効な開始日・終了日を指定してください。" }, { status: 400 });
    }
    // ダッシュボードの件数取得は名簿詳細や車両を取得しない。
    if (req.nextUrl.searchParams.get("countDrivers") === "1") {
      const [courses, drivers] = await Promise.all([
        supabase.from("courses").select("id").eq("org_id", orgId),
        supabase.from("drivers").select("id").eq("org_id", orgId).eq("works_as_driver", true),
      ]);
      if (courses.error || drivers.error) throw courses.error ?? drivers.error;
      const courseIds = (courses.data ?? []).map(c => c.id), driverIds = (drivers.data ?? []).map(d => d.id);
      if (!courseIds.length || !driverIds.length) return NextResponse.json({ count: 0 });
      const { data, error } = await supabase.from("shifts").select("driver_id")
        .in("course_id", courseIds).in("driver_id", driverIds).gte("shift_date", startDate).lte("shift_date", endDate);
      if (error) throw error;
      return NextResponse.json({ count: new Set((data ?? []).map(s => s.driver_id)).size });
    }
    // 関連表を読む前に自社の集合を確定する。空集合を「条件なし」にしない。
    const [courseResult, driverResult, fleetResult] = await Promise.all([
      supabase.from("courses").select("*, course_cycles(id, cycle_no, label, meeting_place, meeting_time, arrival_time, end_time, max_drivers, sort_order, active)").eq("org_id", orgId).order("sort_order"),
      supabase.from("drivers").select("id, name, display_name, role, list_no, driver_code, status, works_as_driver, driver_identities(driver_courses(course_id))").eq("org_id", orgId).order("list_no", { ascending: true, nullsFirst: false }).order("name"),
      supabase.from("vehicles").select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage, is_ev, is_disposed, is_unavailable, unavailable_reason, last_oil_change_mileage, oil_change_interval").eq("owner_org_id", orgId).order("manufacturer").order("brand"),
    ]);
    for (const result of [courseResult, driverResult, fleetResult]) if (result.error) throw result.error;
    const courses = courseResult.data ?? [];
    const members = driverResult.data ?? [];
    const vehicles = fleetResult.data ?? [];
    const courseIds = courses.map(c => c.id), driverIds = members.map(d => d.id), vehicleIds = vehicles.map(v => v.id);
    const driverById = new Map(members.map(d => [d.id, d]));
    const fleetById = new Map(vehicles.map(v => [v.id, v]));
    const shiftsResult = courseIds.length ? await supabase.from("shifts")
      .select("id, shift_date, course_id, cycle_no, slot, driver_id, vehicle_id, uses_external_vehicle, meeting_place, meeting_time, arrival_time, end_time")
      .in("course_id", courseIds).gte("shift_date", startDate).lte("shift_date", endDate) : { data: [], error: null };
    if (shiftsResult.error) throw shiftsResult.error;
    // 既存の不正な横断参照もレスポンスへ流さない。
    const shifts = (shiftsResult.data ?? []).filter(s => !s.driver_id || driverById.has(s.driver_id)).map(s => {
      const driver = driverById.get(s.driver_id);
      const vehicle = fleetById.get(s.vehicle_id);
      return { ...s, vehicle_id: vehicle?.id ?? null, vehicles: vehicle && !vehicle.is_disposed ? vehicle : null,
        drivers: driver ? { id: driver.id, name: driver.name, display_name: driver.display_name } : null };
    });
    const recent = new Date(`${startDate}T00:00:00Z`);
    recent.setUTCDate(recent.getUTCDate() - 35);
    const empty = { data: [], error: null };
    const results = await Promise.all([
      driverIds.length && vehicleIds.length ? supabase.from("vehicle_drivers").select("driver_id, vehicle_id").in("driver_id", driverIds).in("vehicle_id", vehicleIds) : empty,
      vehicleIds.length ? supabase.from("vehicle_loans").select("vehicle_id, loan_date, note").in("vehicle_id", vehicleIds).gte("loan_date", startDate).lte("loan_date", endDate) : empty,
      driverIds.length ? supabase.from("shift_requests").select("*").in("driver_id", driverIds).gte("request_date", startDate).lte("request_date", endDate) : empty,
      // 便はcarrierに属す共有マスター（会社固有の個人データではない）。
      supabase.from("shift_request_slots").select("id, name, start_time, end_time").eq("active", true).order("sort_order"),
      courseIds.length && driverIds.length ? supabase.from("shifts").select("driver_id, course_id, shift_date").in("course_id", courseIds).in("driver_id", driverIds).gte("shift_date", recent.toISOString().slice(0, 10)).lt("shift_date", startDate) : empty,
    ]);
    for (const result of results) if (result.error) throw result.error;
    const [links, loans, requests, slots, assignments] = results;
    const courseSet = new Set(courseIds);
    const drivers = members.filter(d => d.works_as_driver && d.status === "active").map(d => ({ ...d,
      driver_identities: (d.driver_identities ?? []).map(identity => ({ ...identity, driver_courses: (identity.driver_courses ?? []).filter(c => courseSet.has(c.course_id)) })),
    }));
    return NextResponse.json({ courses: courses.filter(c => !c.archived_at), shifts, drivers,
      requests: requests.data, slots: slots.data, vehicles: vehicles.filter(v => !v.is_disposed),
      vehicle_driver_links: links.data, vehicle_loans: loans.data, recent_assignments: assignments.data });
  } catch (error) {
    return adminMutationError(error);
  }
}

// POST: シフト登録/更新
// 車両割当は独立エンドポイント /api/admin/shifts/vehicle（can_dispatch）に分離（A1）。
// ここではドライバー割当のみを扱い、割当解除時だけ車両も連動クリアする。
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { shiftDate, courseId, driverId, slot, cycleNo } = body as {
      shiftDate?: string;
      courseId?: string;
      driverId?: string | null;
      slot?: number;
      cycleNo?: number;
    };

    if (!isDateOnly(shiftDate) || !isUuid(courseId) || (driverId != null && !isUuid(driverId))) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    if (!await belongsToOrg("courses", courseId, user.orgId) || (driverId && !await belongsToOrg("drivers", driverId, user.orgId))) {
      return NextResponse.json({ error: "対象のコースまたはドライバーが見つかりません。" }, { status: 404 });
    }

    const slotNumber = Number.isFinite(slot) && Number(slot) >= 1 ? Math.floor(Number(slot)) : 1;
    const cycleNumber = Number.isInteger(cycleNo) && Number(cycleNo) >= 0 ? Number(cycleNo) : 0;

    // 変更ログ用に変更前の割当を読む（軽い1読取。ログ自体はベストエフォート）。
    const { data: prevRow, error: previousError } = await supabase
      .from("shifts")
      .select("driver_id")
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("cycle_no", cycleNumber)
      .eq("slot", slotNumber)
      .maybeSingle();

    if (previousError) throw previousError;

    const upsertRow: Record<string, unknown> = {
      shift_date: shiftDate,
      course_id: courseId,
      cycle_no: cycleNumber,
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
    return adminMutationError(err);
  }
}
