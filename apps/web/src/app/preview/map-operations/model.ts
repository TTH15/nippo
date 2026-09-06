import type { VehiclePlateData } from "@repo/core/types";
export { aerialMovementArrowGeometry } from "@/lib/map/aerialMovementArrow";

export type PreviewScenario = "normal" | "attention" | "unrecorded";
export type MapMode = "current" | "movements" | "history";
export const PREVIEW_HISTORY_DEFAULT_AT = "2026-09-01T18:00:00+09:00";

export {
  ACTY_HH5_LENGTH_METERS,
  VEHICLE_TARGET_MAP_WIDTH_RATIO,
  vehicleMapPresentation,
  type VehicleMapPresentation,
} from "@/lib/map/vehiclePresentation";

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

export type VehiclePositionRecord = {
  at: string;
  coordinates: [number, number];
  placeId: string | null;
  recordedBy: string;
  source: "daily_report" | "manual" | "punch";
};

export type PreviewMapVehicle = VehiclePlateData & {
  id: string;
  manufacturer: string;
  brand: string;
  modelCode: string;
  bodyColor: string;
  position: [number, number] | null;
  positionHistory: VehiclePositionRecord[];
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
    positionHistory: [
      { at: "2026-09-01T07:40:00+09:00", coordinates: [135.4707, 34.7777], placeId: "toyonaka", recordedBy: "佐藤", source: "punch" },
      { at: "2026-09-01T20:10:00+09:00", coordinates: [135.4687, 34.7818], placeId: "toyonaka", recordedBy: "佐藤", source: "daily_report" },
    ],
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
    positionHistory: [
      { at: "2026-09-01T09:10:00+09:00", coordinates: [135.5082, 34.7703], placeId: "suita", recordedBy: "高橋", source: "manual" },
      { at: "2026-09-01T21:45:00+09:00", coordinates: [135.5165, 34.7636], placeId: "suita", recordedBy: "高橋", source: "daily_report" },
    ],
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
    positionHistory: [
      { at: "2026-08-31T08:15:00+09:00", coordinates: [135.494, 34.788], placeId: "toyonaka", recordedBy: "山本", source: "punch" },
      { at: "2026-08-31T19:30:00+09:00", coordinates: [135.4892, 34.7964], placeId: "toyonaka", recordedBy: "山本", source: "daily_report" },
    ],
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
    positionHistory: [
      { at: "2026-09-01T08:05:00+09:00", coordinates: [135.4793, 34.7686], placeId: "toyonaka", recordedBy: "加藤", source: "punch" },
      { at: "2026-09-01T19:30:00+09:00", coordinates: [135.4793, 34.7686], placeId: "toyonaka", recordedBy: "加藤", source: "daily_report" },
    ],
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
      positionHistory: vehicle.positionHistory.map((record) => ({
        ...record,
        coordinates: [...record.coordinates] as [number, number],
      })),
      lastParked: vehicle.lastParked ? { ...vehicle.lastParked } : null,
      nextUse: vehicle.nextUse ? { ...vehicle.nextUse } : null,
      movement: vehicle.movement ? { ...vehicle.movement } : null,
    };
  });
}

export function positionRecordAt(vehicle: PreviewMapVehicle, at: string): VehiclePositionRecord | null {
  const targetTime = Date.parse(at);
  return vehicle.positionHistory.reduce<VehiclePositionRecord | null>((latest, record) => {
    const recordTime = Date.parse(record.at);
    if (recordTime > targetTime || (latest && Date.parse(latest.at) >= recordTime)) return latest;
    return record;
  }, null);
}

export function positionForMode(
  vehicle: PreviewMapVehicle,
  mode: MapMode,
  historyAt = PREVIEW_HISTORY_DEFAULT_AT,
): [number, number] | null {
  return mode === "history" ? positionRecordAt(vehicle, historyAt)?.coordinates ?? null : vehicle.position;
}

export function needsVehicleRelocation(movement: VehicleMovement | null): boolean {
  return movement != null
    && movement.status !== "arrived"
    && movement.fromPlaceId !== movement.toPlaceId;
}

export function needsAttention(vehicle: PreviewMapVehicle): boolean {
  return vehicle.position == null || vehicle.lastParked == null || vehicle.movement?.status === "needed";
}

export function placeById(placeId: string | null | undefined): PreviewPlace | null {
  return PREVIEW_PLACES.find((place) => place.id === placeId) ?? null;
}
