import { describe, expect, it } from "vitest";
import {
  movementNeedsAttention,
  needsVehicleRelocation,
  parseMovementDraft,
  type VehicleMovement,
} from "./vehicleMovements";

const movement: VehicleMovement = {
  id: "10000000-0000-4000-8000-000000000001",
  vehicleId: "10000000-0000-4000-8000-000000000002",
  fromPlaceId: "10000000-0000-4000-8000-000000000003",
  toPlaceId: "10000000-0000-4000-8000-000000000004",
  assigneeDriverId: "10000000-0000-4000-8000-000000000005",
  dueAt: "2026-09-03T06:30:00+09:00",
  status: "planned",
  note: null,
  actualPlaceId: null,
  arrivedAt: null,
  version: 1,
  fromPlace: null,
  toPlace: null,
  assignee: null,
};

describe("parseMovementDraft", () => {
  it("移動の保存値を整える", () => {
    expect(
      parseMovementDraft({
        vehicleId: movement.vehicleId,
        fromPlaceId: movement.fromPlaceId,
        toPlaceId: movement.toPlaceId,
        assigneeDriverId: "",
        dueAt: movement.dueAt,
        note: "  鍵は事務所  ",
      }),
    ).toEqual({
      vehicleId: movement.vehicleId,
      fromPlaceId: movement.fromPlaceId,
      toPlaceId: movement.toPlaceId,
      assigneeDriverId: null,
      dueAt: movement.dueAt,
      note: "鍵は事務所",
    });
  });

  it("不正な参照と日時を受け付けない", () => {
    expect(parseMovementDraft({ ...movement, vehicleId: "other" })).toBeNull();
    expect(parseMovementDraft({ ...movement, dueAt: "invalid" })).toBeNull();
  });
});

describe("vehicle movement state", () => {
  it("場所が異なる未完了の手配だけを地図の移動対象にする", () => {
    expect(needsVehicleRelocation(movement)).toBe(true);
    expect(needsVehicleRelocation({ ...movement, toPlaceId: movement.fromPlaceId })).toBe(false);
    expect(needsVehicleRelocation({ ...movement, status: "arrived" })).toBe(false);
  });

  it("担当未設定、期限超過、予定外の到着を要確認にする", () => {
    const beforeDue = new Date("2026-09-02T00:00:00+09:00");
    expect(movementNeedsAttention(movement, beforeDue)).toBe(false);
    expect(movementNeedsAttention({ ...movement, assigneeDriverId: null, status: "needed" }, beforeDue)).toBe(true);
    expect(movementNeedsAttention(movement, new Date("2026-09-04T00:00:00+09:00"))).toBe(true);
    expect(movementNeedsAttention({ ...movement, actualPlaceId: movement.fromPlaceId }, beforeDue)).toBe(true);
  });
});
