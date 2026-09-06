import { describe, expect, it } from "vitest";
import {
  aerialMovementArrowGeometry,
  needsAttention,
  needsVehicleRelocation,
  positionForMode,
  positionRecordAt,
  vehicleMapPresentation,
  vehiclesForScenario,
} from "./model";

describe("map operations preview model", () => {
  it("shows the historical position without overwriting the current record", () => {
    const vehicle = vehiclesForScenario("normal")[0];
    expect(positionForMode(vehicle, "history")).toEqual(vehicle.positionHistory[0].coordinates);
    expect(positionForMode(vehicle, "current")).toEqual(vehicle.position);
    expect(positionForMode(vehicle, "movements")).toEqual(vehicle.position);
  });

  it("reconstructs the last recorded position at the selected time without interpolation", () => {
    const vehicle = vehiclesForScenario("normal")[0];

    expect(positionRecordAt(vehicle, "2026-09-01T06:00:00+09:00")).toBeNull();
    expect(positionRecordAt(vehicle, "2026-09-01T18:00:00+09:00")).toEqual(vehicle.positionHistory[0]);
    expect(positionRecordAt(vehicle, "2026-09-01T22:00:00+09:00")).toEqual(vehicle.positionHistory[1]);
    expect(positionForMode(vehicle, "history", "2026-09-01T22:00:00+09:00")).toEqual(vehicle.position);
  });

  it("marks an unassigned movement as needing attention", () => {
    const vehicle = vehiclesForScenario("attention")[0];
    expect(vehicle.movement?.status).toBe("needed");
    expect(needsAttention(vehicle)).toBe(true);
  });

  it("does not invent a position when no parking record exists", () => {
    const vehicle = vehiclesForScenario("unrecorded")[0];
    expect(vehicle.position).toBeNull();
    expect(vehicle.lastParked).toBeNull();
    expect(needsAttention(vehicle)).toBe(true);
  });

  it("keeps the vehicle at nine percent of the map width before reaching actual size", () => {
    const desktop = vehicleMapPresentation({ mapWidthPixels: 800, zoom: 12, latitude: 34.83 });
    const mobile = vehicleMapPresentation({ mapWidthPixels: 360, zoom: 17, latitude: 34.83 });

    expect(desktop.renderedLengthPixels).toBeCloseTo(72);
    expect(desktop.modelScale).toBeGreaterThan(1);
    expect(mobile.renderedLengthPixels).toBeCloseTo(32.4);
    expect(mobile.modelScale).toBeGreaterThan(1);
  });

  it("stops enlarging the model after its projected size reaches actual scale", () => {
    const presentation = vehicleMapPresentation({ mapWidthPixels: 800, zoom: 22, latitude: 34.83 });

    expect(presentation.modelScale).toBe(1);
    expect(presentation.renderedLengthPixels).toBeGreaterThan(presentation.targetLengthPixels);
  });

  it("lifts a movement arrow above the straight route", () => {
    const arrow = aerialMovementArrowGeometry({
      from: { x: 120, y: 420 },
      to: { x: 620, y: 180 },
      mapWidth: 760,
      mapHeight: 640,
    });

    expect(arrow).not.toBeNull();
    expect(arrow!.control1.y).toBeLessThan(arrow!.start.y);
    expect(arrow!.control2.y).toBeLessThan(arrow!.end.y);
    expect(arrow!.destinationVisible).toBe(true);
    expect(arrow!.end).toEqual({ x: 620, y: 180 });
  });

  it("lets the route leave the map without inventing an arrival point at the edge", () => {
    const arrow = aerialMovementArrowGeometry({
      from: { x: 180, y: 440 },
      to: { x: 1200, y: 80 },
      mapWidth: 760,
      mapHeight: 640,
      edgePadding: 28,
    });

    expect(arrow).not.toBeNull();
    expect(arrow!.destinationVisible).toBe(false);
    expect(arrow!.end.x).toBeGreaterThan(760);
  });

  it("lets a route enter from outside the map without inventing a starting point at the edge", () => {
    const arrow = aerialMovementArrowGeometry({
      from: { x: -440, y: 420 },
      to: { x: 620, y: 180 },
      mapWidth: 760,
      mapHeight: 640,
      edgePadding: 28,
    });

    expect(arrow).not.toBeNull();
    expect(arrow!.sourceVisible).toBe(false);
    expect(arrow!.start.x).toBeLessThan(0);
    expect(arrow!.end).toEqual({ x: 620, y: 180 });
  });

  it("shows only unfinished moves between different places in movement mode", () => {
    const movement = vehiclesForScenario("normal")[0].movement;

    expect(needsVehicleRelocation(movement)).toBe(true);
    expect(needsVehicleRelocation(movement ? { ...movement, status: "arrived" } : null)).toBe(false);
    expect(needsVehicleRelocation(movement ? { ...movement, toPlaceId: movement.fromPlaceId } : null)).toBe(false);
    expect(needsVehicleRelocation(null)).toBe(false);
  });

});
