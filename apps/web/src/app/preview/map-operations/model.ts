import type { VehiclePlateData } from "@repo/core/types";

export type PreviewScenario = "normal" | "attention" | "unrecorded";
export type MapMode = "current" | "history";

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MAPBOX_TILE_SIZE = 512;

export const VEHICLE_TARGET_MAP_WIDTH_RATIO = 0.09;
export const ACTY_HH5_LENGTH_METERS = 3.392;

export type VehicleMapPresentation = {
  modelScale: number;
  targetLengthPixels: number;
  renderedLengthPixels: number;
  contrastRadiusPixels: number;
  markerOffsetPixels: number;
};

export type MapScreenPoint = { x: number; y: number };

export type AerialMovementArrowGeometry = {
  start: MapScreenPoint;
  control1: MapScreenPoint;
  control2: MapScreenPoint;
  end: MapScreenPoint;
  sourceVisible: boolean;
  destinationVisible: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * 地表の直線ではなく、画面上で上空へ持ち上がるアーチを作る。
 * 画面外の行き先を地図端の到着点に見せない。線だけを画面外へ抜き、
 * 矢尻は本当の行き先が表示範囲にあるときだけ出す。
 */
export function aerialMovementArrowGeometry({
  from,
  to,
  mapWidth,
  mapHeight,
  edgePadding = 28,
}: {
  from: MapScreenPoint;
  to: MapScreenPoint;
  mapWidth: number;
  mapHeight: number;
  edgePadding?: number;
}): AerialMovementArrowGeometry | null {
  const minX = edgePadding;
  const maxX = Math.max(minX, mapWidth - edgePadding);
  const minY = edgePadding;
  const maxY = Math.max(minY, mapHeight - edgePadding);
  const sourceVisible = from.x >= minX && from.x <= maxX && from.y >= minY && from.y <= maxY;
  const destinationVisible = to.x >= minX && to.x <= maxX && to.y >= minY && to.y <= maxY;
  const rawDx = to.x - from.x;
  const rawDy = to.y - from.y;
  const rawDistance = Math.hypot(rawDx, rawDy);
  if (rawDistance < 48) return null;

  const unitX = rawDx / rawDistance;
  const unitY = rawDy / rawDistance;
  const startInset = Math.min(38, rawDistance * 0.1);
  const start = {
    x: clamp(from.x + unitX * startInset, minX, maxX),
    y: clamp(from.y + unitY * startInset - Math.min(24, rawDistance * 0.06), minY, maxY),
  };

  let end = { x: to.x, y: to.y };
  let visibleEnd = end;
  if (!destinationVisible) {
    const dx = to.x - start.x;
    const dy = to.y - start.y;
    let t = 1;
    if (dx > 0) t = Math.min(t, (maxX - start.x) / dx);
    if (dx < 0) t = Math.min(t, (minX - start.x) / dx);
    if (dy > 0) t = Math.min(t, (maxY - start.y) / dy);
    if (dy < 0) t = Math.min(t, (minY - start.y) / dy);
    visibleEnd = { x: start.x + dx * Math.max(0, t), y: start.y + dy * Math.max(0, t) };
    const exitDx = visibleEnd.x - start.x;
    const exitDy = visibleEnd.y - start.y;
    const exitDistance = Math.max(1, Math.hypot(exitDx, exitDy));
    const overshoot = 96;
    end = {
      x: visibleEnd.x + (exitDx / exitDistance) * overshoot,
      y: visibleEnd.y + (exitDy / exitDistance) * overshoot,
    };
  }

  const visibleDistance = Math.hypot(visibleEnd.x - start.x, visibleEnd.y - start.y);
  if (visibleDistance < 44) return null;

  const lift = clamp(visibleDistance * 0.22, 64, 120);
  const skyY = Math.max(minY + 20, Math.min(start.y, visibleEnd.y) - lift);
  return {
    start,
    control1: { x: start.x + (visibleEnd.x - start.x) * 0.28, y: skyY },
    control2: { x: start.x + (visibleEnd.x - start.x) * 0.82, y: skyY },
    end,
    sourceVisible,
    destinationVisible,
  };
}

export function vehicleMapPresentation({
  mapWidthPixels,
  zoom,
  latitude,
  vehicleLengthMeters = ACTY_HH5_LENGTH_METERS,
}: {
  mapWidthPixels: number;
  zoom: number;
  latitude: number;
  vehicleLengthMeters?: number;
}): VehicleMapPresentation {
  const width = Math.max(1, mapWidthPixels);
  const length = Math.max(0.1, vehicleLengthMeters);
  const safeLatitude = Math.min(85, Math.max(-85, latitude));
  const metersPerPixel = (
    Math.cos((safeLatitude * Math.PI) / 180) * EARTH_CIRCUMFERENCE_METERS
  ) / (MAPBOX_TILE_SIZE * Math.pow(2, zoom));
  const targetLengthPixels = width * VEHICLE_TARGET_MAP_WIDTH_RATIO;
  const actualLengthPixels = length / metersPerPixel;
  const modelScale = Math.max(1, targetLengthPixels / actualLengthPixels);
  const renderedLengthPixels = actualLengthPixels * modelScale;

  return {
    modelScale,
    targetLengthPixels,
    renderedLengthPixels,
    contrastRadiusPixels: Math.max(10, renderedLengthPixels * 0.46),
    markerOffsetPixels: Math.max(28, renderedLengthPixels * 0.62),
  };
}

export type PreviewPlace = {
  id: string;
  name: string;
  coordinates: [number, number];
};

export type VehicleMovement = {
  fromPlaceId: string;
  toPlaceId: string;
  dueAt: string;
  assignee: string | null;
  status: "needed" | "planned" | "arrived";
};

export type PreviewMapVehicle = VehiclePlateData & {
  id: string;
  manufacturer: string;
  brand: string;
  modelCode: string;
  bodyColor: string;
  position: [number, number] | null;
  historyPosition: [number, number] | null;
  lastParked: {
    placeId: string;
    at: string;
    recordedBy: string;
  } | null;
  nextUse: {
    at: string;
    driver: string;
    course: string;
    placeId: string;
  } | null;
  movement: VehicleMovement | null;
};

export const PREVIEW_PLACES: PreviewPlace[] = [
  { id: "toyonaka", name: "豊中車庫", coordinates: [135.4687, 34.7818] },
  { id: "suita", name: "吹田車庫", coordinates: [135.5165, 34.7636] },
  { id: "kyoto", name: "京都車庫", coordinates: [135.7554, 34.9572] },
];

const baseVehicles: PreviewMapVehicle[] = [
  {
    id: "acty-1201",
    manufacturer: "ホンダ",
    brand: "アクティバン",
    modelCode: "HH5",
    bodyColor: "#2563eb",
    number_prefix: "大阪",
    number_class: "480",
    number_hiragana: "り",
    number_numeric: "1201",
    plate_color: "black",
    position: [135.4687, 34.7818],
    historyPosition: [135.4707, 34.7777],
    lastParked: { placeId: "toyonaka", at: "2026-09-01T20:10:00+09:00", recordedBy: "佐藤" },
    nextUse: {
      at: "2026-09-03T07:00:00+09:00",
      driver: "田中",
      course: "京都上鳥羽",
      placeId: "kyoto",
    },
    movement: {
      fromPlaceId: "toyonaka",
      toPlaceId: "kyoto",
      dueAt: "2026-09-03T06:30:00+09:00",
      assignee: "高橋",
      status: "planned",
    },
  },
  {
    id: "acty-2752",
    manufacturer: "ホンダ",
    brand: "アクティバン",
    modelCode: "HH5",
    bodyColor: "#f1f5f9",
    number_prefix: "京都",
    number_class: "480",
    number_hiragana: "れ",
    number_numeric: "2752",
    plate_color: "black",
    position: [135.5165, 34.7636],
    historyPosition: [135.5082, 34.7703],
    lastParked: { placeId: "suita", at: "2026-09-01T21:45:00+09:00", recordedBy: "高橋" },
    nextUse: {
      at: "2026-09-03T07:30:00+09:00",
      driver: "高橋",
      course: "豊中Amazon",
      placeId: "suita",
    },
    movement: null,
  },
  {
    id: "acty-4303",
    manufacturer: "ホンダ",
    brand: "アクティバン",
    modelCode: "HH5",
    bodyColor: "#1f2937",
    number_prefix: "大阪",
    number_class: "480",
    number_hiragana: "り",
    number_numeric: "4303",
    plate_color: "black",
    position: [135.4892, 34.7964],
    historyPosition: [135.494, 34.788],
    lastParked: { placeId: "toyonaka", at: "2026-08-31T19:30:00+09:00", recordedBy: "山本" },
    nextUse: {
      at: "2026-09-03T08:00:00+09:00",
      driver: "山本",
      course: "吹田",
      placeId: "suita",
    },
    movement: {
      fromPlaceId: "toyonaka",
      toPlaceId: "suita",
      dueAt: "2026-09-03T07:20:00+09:00",
      assignee: null,
      status: "needed",
    },
  },
  {
    id: "acty-5854",
    manufacturer: "ホンダ",
    brand: "アクティバン",
    modelCode: "HH5",
    bodyColor: "#94a3b8",
    number_prefix: "京都",
    number_class: "480",
    number_hiragana: "れ",
    number_numeric: "5854",
    plate_color: "black",
    position: [135.4793, 34.7686],
    historyPosition: [135.4793, 34.7686],
    lastParked: { placeId: "toyonaka", at: "2026-09-01T19:30:00+09:00", recordedBy: "加藤" },
    nextUse: null,
    movement: null,
  },
];

export function vehiclesForScenario(scenario: PreviewScenario): PreviewMapVehicle[] {
  return baseVehicles.map((vehicle) => {
    if (scenario === "attention" && vehicle.id === "acty-1201") {
      return {
        ...vehicle,
        movement: vehicle.movement ? { ...vehicle.movement, assignee: null, status: "needed" } : null,
      };
    }
    if (scenario === "unrecorded" && vehicle.id === "acty-1201") {
      return { ...vehicle, position: null, lastParked: null };
    }
    return {
      ...vehicle,
      lastParked: vehicle.lastParked ? { ...vehicle.lastParked } : null,
      nextUse: vehicle.nextUse ? { ...vehicle.nextUse } : null,
      movement: vehicle.movement ? { ...vehicle.movement } : null,
    };
  });
}

export function positionForMode(vehicle: PreviewMapVehicle, mode: MapMode): [number, number] | null {
  return mode === "history" ? vehicle.historyPosition : vehicle.position;
}

export function needsAttention(vehicle: PreviewMapVehicle): boolean {
  return vehicle.position == null || vehicle.lastParked == null || vehicle.movement?.status === "needed";
}

export function placeById(placeId: string | null | undefined): PreviewPlace | null {
  return PREVIEW_PLACES.find((place) => place.id === placeId) ?? null;
}
