import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { adminMutationError, belongsToOrg, isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import { isMissingOrgColumn } from "@/server/db/orgColumn";
import { logShiftChange } from "@/server/shiftLog";
import { isMemberInPeriod } from "@/lib/drivers/activePeriod";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";

// IN句のURL上限と行数上限をそれぞれ避ける。各queryは一意なorderとrangeを指定する。
async function fetchByIds<T>(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CLAUSE_BATCH_SIZE) {
    const slice = ids.slice(i, i + IN_CLAUSE_BATCH_SIZE);
    rows.push(...await fetchAllRows((from, to) => query(slice, from, to)));
  }
  return rows;
}

export const dynamic = "force-dynamic";

// GET: 指定期間のシフト取得
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const startedAt = performance.now();
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
        fetchAllRows((from, to) => supabase.from("courses").select("id").eq("org_id", orgId).order("id").range(from, to)),
        fetchAllRows((from, to) => supabase.from("drivers").select("id").eq("org_id", orgId).eq("works_as_driver", true).order("id").range(from, to)),
      ]);
      const courseIds = courses.map(c => c.id), driverIds = new Set(drivers.map(d => d.id));
      if (!courseIds.length || !driverIds.size) return NextResponse.json({ count: 0 });
      const rows = await fetchByIds(courseIds, (slice, from, to) => supabase.from("shifts").select("driver_id")
        // tenant-scope-ok: slice は自社の courses（org_id）から作った集合。driverIdsでも応答を絞る
        .in("course_id", slice).gte("shift_date", startDate).lte("shift_date", endDate).order("id").range(from, to));
      return NextResponse.json({ count: new Set(rows.filter(s => driverIds.has(s.driver_id)).map(s => s.driver_id)).size });
    }
    // 関連表を読む前に自社の集合を確定する。空集合を「条件なし」にしない。
    const [courses, members, vehicles] = await Promise.all([
      fetchAllRows((from, to) => supabase.from("courses").select("*, course_cycles(id, cycle_no, label, meeting_place, meeting_time, arrival_time, end_time, max_drivers, sort_order, active)").eq("org_id", orgId).order("sort_order").order("id").range(from, to)),
      fetchAllRows((from, to) => supabase.from("drivers").select("id, name, display_name, role, list_no, shift_sort_order, driver_code, status, works_as_driver, active_from_month, active_until_month, created_at, driver_identities(driver_courses(course_id))").eq("org_id", orgId).order("shift_sort_order", { ascending: true, nullsFirst: false }).order("list_no", { ascending: true, nullsFirst: false }).order("name").order("id").range(from, to)),
      fetchAllRows((from, to) => supabase.from("vehicles").select("id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand, current_mileage, is_ev, is_disposed, is_unavailable, unavailable_reason, last_oil_change_mileage, oil_change_interval").eq("owner_org_id", orgId).order("manufacturer").order("brand").order("id").range(from, to)),
    ]);
    const mastersAt = performance.now();
    const courseIds = courses.map(c => c.id), driverIds = members.map(d => d.id), vehicleIds = vehicles.map(v => v.id);
    const driverById = new Map(members.map(d => [d.id, d]));
    const fleetById = new Map(vehicles.map(v => [v.id, v]));
    // tenant-scope-ok: courseIds / driverIds は自社の courses・drivers（.eq("org_id", orgId)）から作った集合
    const shiftRows = await fetchByIds(courseIds, (slice, from, to) => supabase.from("shifts")
      .select("id, shift_date, course_id, cycle_no, slot, driver_id, vehicle_id, uses_external_vehicle, meeting_place, meeting_time, arrival_time, end_time")
      .in("course_id", slice).gte("shift_date", startDate).lte("shift_date", endDate).order("id").range(from, to));
    const shiftsAt = performance.now();
    // 既存の不正な横断参照もレスポンスへ流さない。
    const shifts = shiftRows.filter(s => !s.driver_id || driverById.has(s.driver_id)).map(s => {
      const driver = driverById.get(s.driver_id);
      const vehicle = fleetById.get(s.vehicle_id);
      return { ...s, vehicle_id: vehicle?.id ?? null, vehicles: vehicle && !vehicle.is_disposed ? vehicle : null,
        drivers: driver ? { id: driver.id, name: driver.name, display_name: driver.display_name } : null };
    });
    const recent = new Date(`${startDate}T00:00:00Z`);
    recent.setUTCDate(recent.getUTCDate() - 35);
    const [links, loans, requests, slots, assignments, leases] = await Promise.all([
      (async () => {
        const rows = [];
        for (let i = 0; i < driverIds.length; i += IN_CLAUSE_BATCH_SIZE) {
          const driverSlice = driverIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
          rows.push(...await fetchByIds(vehicleIds, (vehicleSlice, from, to) => supabase.from("vehicle_drivers")
            // tenant-scope-ok: 両sliceは自社のdriversとvehiclesから作った集合
            .select("driver_id, vehicle_id").in("driver_id", driverSlice).in("vehicle_id", vehicleSlice).order("id").range(from, to)));
        }
        return rows;
      })(),
      fetchByIds(vehicleIds, (slice, from, to) => supabase.from("vehicle_loans").select("vehicle_id, loan_date, note")
        .in("vehicle_id", slice).gte("loan_date", startDate).lte("loan_date", endDate).order("id").range(from, to)),
      // tenant-scope-ok: slice は自社の drivers（org_id）から作った集合
      fetchByIds(driverIds, (slice, from, to) => supabase.from("shift_requests").select("*")
        .in("driver_id", slice).gte("request_date", startDate).lte("request_date", endDate).order("id").range(from, to)),
      // tenant-scope-ok: 便は共有マスタ。元請→下請へ設定が伝わる構造を保つ（編集は所有会社だけ）
      fetchAllRows((from, to) => supabase.from("shift_request_slots").select("id, name, start_time, end_time")
        .eq("active", true).order("sort_order").order("id").range(from, to)),
      // tenant-scope-ok: slice は自社の courses（org_id）から作った集合。応答はdriverByIdでも絞る
      fetchByIds(courseIds, (slice, from, to) => supabase.from("shifts").select("driver_id, course_id, shift_date")
        .in("course_id", slice).gte("shift_date", recent.toISOString().slice(0, 10)).lt("shift_date", startDate).order("id").range(from, to)),
      // 区分のみ。金額は返さない。取得失敗はnullで知らせ、空の契約一覧と区別する。
      // tenant-scope-ok: slice は自社の drivers（org_id）から作った集合
      fetchByIds(driverIds, (slice, from, to) => supabase.from("driver_leases").select("id, driver_id, mode, valid_from, valid_to")
        .in("driver_id", slice).lte("valid_from", endDate).or(`valid_to.is.null,valid_to.gte.${startDate}`).order("id").range(from, to)).catch(() => null),
    ]);
    const detailsAt = performance.now();
    const courseSet = new Set(courseIds);
    const assignedDriverIds = new Set(shifts.map(s => s.driver_id));
    const assignedCourseIds = new Set(shifts.map(s => s.course_id));
    const drivers = members.filter(d => d.works_as_driver &&
      (isMemberInPeriod(d, startDate, endDate) || assignedDriverIds.has(d.id))).map(d => ({ ...d,
      driver_identities: (d.driver_identities ?? []).map(identity => ({ ...identity, driver_courses: (identity.driver_courses ?? []).filter(c => courseSet.has(c.course_id)) })),
    }));
    return NextResponse.json({ courses: courses.filter(c => !c.archived_at || assignedCourseIds.has(c.id)), shifts, drivers,
      requests, slots, vehicles: vehicles.filter(v => !v.is_disposed),
      vehicle_driver_links: links, vehicle_loans: loans, recent_assignments: assignments.filter(s => driverById.has(s.driver_id)),
      // nullは取得失敗。空配列（契約なし）へ置換せず、画面で再試行を案内する。
      driver_leases: leases === null ? null : leases.map(({ id, driver_id, mode, valid_from, valid_to }) => ({ id, driver_id, mode, valid_from, valid_to })) }, {
      headers: { "Server-Timing": `masters;dur=${(mastersAt - startedAt).toFixed(1)}, shifts;dur=${(shiftsAt - mastersAt).toFixed(1)}, details;dur=${(detailsAt - shiftsAt).toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}` },
    });
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
    const { shiftDate, courseId, driverId, slot, cycleNo, expectedDriverId, hasExpectation } = body as {
      shiftDate?: string;
      courseId?: string;
      driverId?: string | null;
      slot?: number;
      cycleNo?: number;
      /** 画面で見ていた現在値。これと違っていれば他の人が変えたということ */
      expectedDriverId?: string | null;
      hasExpectation?: boolean;
    };

    if (!isDateOnly(shiftDate) || !isUuid(courseId) || (driverId != null && !isUuid(driverId))) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    if (!await belongsToOrg("courses", courseId, user.orgId) || (driverId && !await belongsToOrg("drivers", driverId, user.orgId))) {
      return NextResponse.json({ error: "対象のコースまたはドライバーが見つかりません。" }, { status: 404 });
    }

    const slotNumber = Number.isFinite(slot) && Number(slot) >= 1 ? Math.floor(Number(slot)) : 1;
    const cycleNumber = Number.isInteger(cycleNo) && Number(cycleNo) >= 0 ? Number(cycleNo) : 0;
    const expects = hasExpectation === true;
    if (expects && expectedDriverId != null && !isUuid(expectedDriverId)) {
      return NextResponse.json({ error: "expectedDriverId が不正です" }, { status: 400 });
    }

    // 競合検知と監査履歴を1トランザクションで行う RPC（migration 172）。
    // 未適用の環境では下の従来経路へ落とす（画面は止めない）。
    {
      const { data, error } = await supabase.rpc("assign_shift_driver", {
        p_org_id: user.orgId,
        p_actor_id: user.driverId,
        p_date: shiftDate,
        p_course_id: courseId,
        p_cycle_no: cycleNumber,
        p_slot: slotNumber,
        p_driver_id: driverId || null,
        p_expect_driver_id: expects ? expectedDriverId ?? null : null,
        p_expect_present: expects,
      });
      if (!error) return NextResponse.json({ shift: data });
      // 40001 = 読み込み後に他の人が変えた。再取得して確認してもらう
      if (error.code === "40001") {
        return NextResponse.json(
          { error: "別の変更が保存されています。最新の状態を確認してください。", conflict: true },
          { status: 409 },
        );
      }
      // コース・便・ドライバーが自社の有効なものでない
      if (error.code === "P0002") {
        return NextResponse.json({ error: "対象のコース・便・ドライバーが見つかりません。" }, { status: 404 });
      }
      // P0001 = 関数が判断した「所属・実行者が不正」
      if (error.code === "P0001") {
        return NextResponse.json({ error: "この操作の権限がありません。" }, { status: 403 });
      }
      // 関数が無い（migration 172 未適用）／実行権限が無い環境だけ従来経路へ落とす。
      // メッセージの文面では判定しない（将来 PGRST203 等で黙って競合検知が無効化されるため）
      const missingFunction = error.code === "PGRST202" || error.code === "42883" || error.code === "42501";
      if (!missingFunction) throw error;
      console.error("[shifts] assign_shift_driver を使えないため従来経路で保存します", error.code, error.message);
    }

    // 変更ログ用に変更前の割当を読む（軽い1読取。ログ自体はベストエフォート）。
    const { data: prevRow, error: previousError } = await supabase
      // tenant-scope-ok: 直上の belongsToOrg で自社のコース・ドライバーと確認済み
      .from("shifts")
      .select("driver_id")
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("cycle_no", cycleNumber)
      .eq("slot", slotNumber)
      .maybeSingle();

    if (previousError) throw previousError;

    const upsertRow: Record<string, unknown> = {
      org_id: user.orgId,
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
    let { data, error } = await supabase
      // tenant-scope-ok: upsertRow に org_id: user.orgId（認証済み）を入れている
      .from("shifts")
      // cycle_no は便（migration 136）。便を使わないコースは 0 のままで従来と同じ挙動
      .upsert(upsertRow, { onConflict: "shift_date,course_id,cycle_no,slot" })
      .select()
      .single();
    if (isMissingOrgColumn(error)) {
      // migration 175 未適用の環境向けフォールバック（org_id 列がまだ無い）
      delete upsertRow.org_id;
      ({ data, error } = await supabase
        // tenant-scope-ok: 同じ行の退避。migration 175 未適用（org_id 列が無い）環境でのみ通る
        .from("shifts")
        .upsert(upsertRow, { onConflict: "shift_date,course_id,cycle_no,slot" })
        .select()
        .single());
    }

    if (error) throw error;

    if ((prevRow?.driver_id ?? null) !== (driverId || null)) {
      void logShiftChange({
        orgId: user.orgId,
        actorDriverId: user.driverId,
        action: driverId ? "assign_driver" : "clear_driver",
        shiftDate,
        courseId,
        cycleNo: cycleNumber,
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
