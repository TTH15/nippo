export type VehicleMovementStatus = "needed" | "planned" | "arrived" | "cancelled";

export type VehicleMovement = {
  id: string;
  vehicleId: string;
  fromPlaceId: string;
  toPlaceId: string;
  assigneeDriverId: string | null;
  dueAt: string;
  status: VehicleMovementStatus;
  note: string | null;
  actualPlaceId: string | null;
  arrivedAt: string | null;
  version: number;
  fromPlace: { id: string; name: string; lat: number; lng: number } | null;
  toPlace: { id: string; name: string; lat: number; lng: number } | null;
  assignee: { id: string; name: string } | null;
};

export type MovementDraft = {
  vehicleId: string;
  fromPlaceId: string;
  toPlaceId: string;
  assigneeDriverId: string | null;
  dueAt: string;
  note: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function parseMovementDraft(value: unknown): MovementDraft | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
  const fromPlaceId = typeof body.fromPlaceId === "string" ? body.fromPlaceId : "";
  const toPlaceId = typeof body.toPlaceId === "string" ? body.toPlaceId : "";
  const assigneeDriverId =
    body.assigneeDriverId == null || body.assigneeDriverId === ""
      ? null
      : typeof body.assigneeDriverId === "string"
        ? body.assigneeDriverId
        : "";
  const dueAt = typeof body.dueAt === "string" ? body.dueAt : "";
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (
    !UUID_PATTERN.test(vehicleId) ||
    !UUID_PATTERN.test(fromPlaceId) ||
    !UUID_PATTERN.test(toPlaceId) ||
    (assigneeDriverId !== null && !UUID_PATTERN.test(assigneeDriverId)) ||
    !Number.isFinite(Date.parse(dueAt)) ||
    (note?.length ?? 0) > 200
  ) {
    return null;
  }
  return { vehicleId, fromPlaceId, toPlaceId, assigneeDriverId, dueAt, note };
}

export function needsVehicleRelocation(movement: VehicleMovement): boolean {
  return (
    (movement.status === "needed" || movement.status === "planned") &&
    movement.fromPlaceId !== movement.toPlaceId
  );
}

export function movementNeedsAttention(movement: VehicleMovement, now = new Date()): boolean {
  const active = movement.status === "needed" || movement.status === "planned";
  return (
    movement.status === "needed" ||
    (active && Date.parse(movement.dueAt) < now.getTime()) ||
    (movement.actualPlaceId !== null && movement.actualPlaceId !== movement.toPlaceId)
  );
}
