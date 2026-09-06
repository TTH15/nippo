import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { adminMutationError, isUuid } from "@/server/db/adminResourceScope";
import { parseMovementDraft, type VehicleMovementStatus } from "@/lib/map/vehicleMovements";

export const dynamic = "force-dynamic";

type PlaceRow = { id: string; name: string; lat: number; lng: number };
type DriverRow = { id: string; name: string; display_name: string | null };
type MovementRow = {
  id: string;
  vehicle_id: string;
  from_place_id: string;
  to_place_id: string;
  assignee_driver_id: string | null;
  due_at: string;
  status: VehicleMovementStatus;
  note: string | null;
  actual_place_id: string | null;
  arrived_at: string | null;
  version: number;
};

function movementResponse(row: MovementRow, places: Map<string, PlaceRow>, drivers: Map<string, DriverRow>) {
  const fromPlace = places.get(row.from_place_id) ?? null;
  const toPlace = places.get(row.to_place_id) ?? null;
  const assignee = row.assignee_driver_id ? drivers.get(row.assignee_driver_id) ?? null : null;
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    fromPlaceId: row.from_place_id,
    toPlaceId: row.to_place_id,
    assigneeDriverId: row.assignee_driver_id,
    dueAt: row.due_at,
    status: row.status,
    note: row.note,
    actualPlaceId: row.actual_place_id,
    arrivedAt: row.arrived_at,
    version: row.version,
    fromPlace: fromPlace ? { id: fromPlace.id, name: fromPlace.name, lat: fromPlace.lat, lng: fromPlace.lng } : null,
    toPlace: toPlace ? { id: toPlace.id, name: toPlace.name, lat: toPlace.lat, lng: toPlace.lng } : null,
    assignee: assignee ? { id: assignee.id, name: assignee.display_name || assignee.name } : null,
  };
}

function dateInJst(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 86_400_000));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

// 車両移動モードで使う予定・登録拠点・担当候補・次の配車をまとめて返す。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  if (!user.capabilities?.has("can_view_shifts")) {
    return NextResponse.json({ error: "この操作は許可されていません。" }, { status: 403 });
  }

  try {
    const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
    const [placesResult, driversResult, vehiclesResult, coursesResult, movementsResult] = await Promise.all([
      supabase.from("map_places").select("id, name, lat, lng").eq("org_id", orgId).order("name"),
      supabase
        .from("drivers")
        .select("id, name, display_name")
        .eq("org_id", orgId)
        .eq("status", "active")
        .eq("works_as_driver", true)
        .order("name"),
      supabase
        .from("vehicles")
        .select("id")
        .eq("owner_org_id", orgId)
        .eq("is_disposed", false),
      supabase.from("courses").select("id, name").eq("org_id", orgId),
      supabase
        .from("vehicle_movements")
        .select("id, vehicle_id, from_place_id, to_place_id, assignee_driver_id, due_at, status, note, actual_place_id, arrived_at, version")
        .eq("org_id", orgId)
        .in("status", ["needed", "planned"])
        .order("due_at")
        .order("id"),
    ]);
    for (const result of [placesResult, driversResult, vehiclesResult, coursesResult, movementsResult]) {
      if (result.error) throw result.error;
    }

    const places = (placesResult.data ?? []) as PlaceRow[];
    const drivers = (driversResult.data ?? []) as DriverRow[];
    const vehicleIds = (vehiclesResult.data ?? []).map((row) => row.id);
    const courseRows = (coursesResult.data ?? []) as { id: string; name: string }[];
    const courseIds = courseRows.map((row) => row.id);
    const driverById = new Map(drivers.map((row) => [row.id, row]));
    const placeById = new Map(places.map((row) => [row.id, row]));
    const courseById = new Map(courseRows.map((row) => [row.id, row]));

    const shiftResult = vehicleIds.length && courseIds.length
      ? await supabase
          .from("shifts")
          .select("id, shift_date, meeting_time, vehicle_id, driver_id, course_id, cycle_no, slot")
          .in("vehicle_id", vehicleIds)
          .in("course_id", courseIds)
          .gte("shift_date", dateInJst(0))
          .lte("shift_date", dateInJst(14))
          .order("shift_date")
          .order("meeting_time")
      : { data: [], error: null };
    if (shiftResult.error) throw shiftResult.error;

    const upcomingUses = (shiftResult.data ?? []).map((shift) => {
      const driver = shift.driver_id ? driverById.get(shift.driver_id) ?? null : null;
      const course = courseById.get(shift.course_id) ?? null;
      return {
        id: shift.id,
        vehicleId: shift.vehicle_id,
        shiftDate: shift.shift_date,
        meetingTime: shift.meeting_time,
        driver: driver ? { id: driver.id, name: driver.display_name || driver.name } : null,
        course: course ? { id: course.id, name: course.name } : null,
        cycleNo: shift.cycle_no,
        slot: shift.slot,
      };
    });

    return NextResponse.json({
      movements: ((movementsResult.data ?? []) as MovementRow[]).map((row) =>
        movementResponse(row, placeById, driverById),
      ),
      places,
      drivers: drivers.map((driver) => ({ id: driver.id, name: driver.display_name || driver.name })),
      upcomingUses,
    });
  } catch (error) {
    return adminMutationError(error);
  }
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_dispatch");
  if (isAuthError(user)) return user;
  try {
    const draft = parseMovementDraft(await req.json().catch(() => null));
    if (!draft) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
    const { data, error } = await supabase.rpc("save_vehicle_movement", {
      p_org_id: orgId,
      p_actor_id: user.driverId,
      p_movement_id: randomUUID(),
      p_vehicle_id: draft.vehicleId,
      p_from_place_id: draft.fromPlaceId,
      p_to_place_id: draft.toPlaceId,
      p_assignee_driver_id: draft.assigneeDriverId,
      p_due_at: draft.dueAt,
      p_note: draft.note,
      p_expected_version: null,
      p_create: true,
    });
    if (error) throw error;
    return NextResponse.json({ movement: data }, { status: 201 });
  } catch (error) {
    return adminMutationError(error);
  }
}

export async function PATCH(req: NextRequest) {
  const user = await requirePermission(req, "can_dispatch");
  if (isAuthError(user)) return user;
  try {
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const version = Number(body?.expectedVersion);
    const action = body?.action;
    if (!isUuid(id) || !Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    }
    const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

    if (action === "cancel") {
      const { data, error } = await supabase.rpc("cancel_vehicle_movement", {
        p_org_id: orgId,
        p_actor_id: user.driverId,
        p_movement_id: id,
        p_expected_version: version,
      });
      if (error) throw error;
      return NextResponse.json({ movement: data });
    }

    if (action === "complete") {
      const actualPlaceId = typeof body?.actualPlaceId === "string" ? body.actualPlaceId : "";
      const arrivedAt = typeof body?.arrivedAt === "string" ? body.arrivedAt : "";
      if (!isUuid(actualPlaceId) || !Number.isFinite(Date.parse(arrivedAt))) {
        return NextResponse.json({ error: "到着場所と日時を指定してください。" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("finish_vehicle_movement", {
        p_org_id: orgId,
        p_actor_id: user.driverId,
        p_movement_id: id,
        p_actual_place_id: actualPlaceId,
        p_arrived_at: arrivedAt,
        p_expected_version: version,
      });
      if (error) throw error;
      return NextResponse.json({ movement: data });
    }

    const draft = parseMovementDraft(body);
    if (action !== "save" || !draft) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("save_vehicle_movement", {
      p_org_id: orgId,
      p_actor_id: user.driverId,
      p_movement_id: id,
      p_vehicle_id: draft.vehicleId,
      p_from_place_id: draft.fromPlaceId,
      p_to_place_id: draft.toPlaceId,
      p_assignee_driver_id: draft.assigneeDriverId,
      p_due_at: draft.dueAt,
      p_note: draft.note,
      p_expected_version: version,
      p_create: false,
    });
    if (error) throw error;
    return NextResponse.json({ movement: data });
  } catch (error) {
    return adminMutationError(error);
  }
}
