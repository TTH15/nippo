"use client";

// ============================================================
// 地図（ベータ）— 車両の最終確認位置を Mapbox 上に表示する。
// 位置ソースは vehicle_sessions の打刻GPS（/api/admin/map/vehicles）。
// マーカーをタップすると吹き出しでナンバープレートを表示する。
// スタイルは Mapbox Standard（3D建物・時間帯ライティング内蔵）。
// 拠点ピンは DB 保存（map_places）。設定モーダルから追加・削除する。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { createRoot, type Root } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBuilding,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faDrawPolygon,
  faGasPump,
  faGear,
  faLocationDot,
  faMagnifyingGlass,
  faPlus,
  faRotateRight,
  faRoute,
  faSquareParking,
  faTrashCan,
  faTriangleExclamation,
  faUsers,
  faWarehouse,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { AerialMovementArrow } from "@/lib/components/AerialMovementArrow";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { DatePicker } from "@/lib/components/DatePicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { TimePicker } from "@/lib/ui/time-picker";
import { useApi } from "@/lib/useApi";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { hasCapability } from "@/lib/capabilities";
import { dateToReportDateStr, reportDateStrToDate, todayJST } from "@/lib/date";
import { useSharedMapView } from "@/lib/map/sharedView";
import {
  movementNeedsAttention,
  needsVehicleRelocation,
  type VehicleMovement,
} from "@/lib/map/vehicleMovements";
import {
  VEHICLE_MODEL_URLS,
  DEFAULT_VEHICLE_MODEL_KEY,
} from "@/lib/vehicleModels";
import {
  VehiclePlate,
  formatPlateNumeric,
  type VehiclePlateData,
} from "@/lib/components/VehiclePlate";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";



// Mapbox Standard の時間帯ライティング。現在時刻から自動で選ぶ。
type LightPreset = "dawn" | "day" | "dusk" | "night";

function presetForHour(hour: number): LightPreset {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "dusk";
  return "night";
}

// 地図表示の設定（個人の好みなので localStorage 保存。DB には置かない）。
type MapViewPrefs = {
  basemap: "standard" | "satellite";
  placeLabels: boolean; // 地名（山・川など自然地名を含む）
  roadLabels: boolean;
  poiLabels: boolean;
  transitLabels: boolean;
  objects3d: boolean; // 3D建物・ランドマーク（航空写真では無効）
  terrain: boolean; // 3D地形（起伏）
};
const VIEW_PREFS_KEY = "hakotora_map_view_prefs";
const DEFAULT_VIEW_PREFS: MapViewPrefs = {
  basemap: "standard",
  placeLabels: true,
  roadLabels: false,
  poiLabels: false,
  transitLabels: false,
  objects3d: true,
  terrain: false,
};

function loadViewPrefs(): MapViewPrefs {
  if (typeof window === "undefined") return DEFAULT_VIEW_PREFS;
  try {
    return { ...DEFAULT_VIEW_PREFS, ...JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

function styleUrlFor(basemap: MapViewPrefs["basemap"]): string {
  return basemap === "satellite"
    ? "mapbox://styles/mapbox/standard-satellite"
    : "mapbox://styles/mapbox/standard";
}

/** 地点検索の結果1件。 */
type GeocodeHit = { id: string; name: string; address: string; lat: number; lng: number };

/**
 * 地点検索。**Mapbox Search Box API** を使う。
 * Geocoding v6 は住所・地名しか返さず、**施設（POI）が出ない**ため、
 * 「ヤマト運輸の営業所」「ガソリンスタンド」のような探し方ができなかった（2026-08-10 指摘）。
 * 地図の中心を proximity に渡し、近い順に出す。
 */
async function searchPlaces(
  query: string,
  proximity: [number, number] | null,
  bbox: string | null,
): Promise<GeocodeHit[]> {
  const params = new URLSearchParams({
    q: query,
    country: "jp",
    language: "ja",
    limit: "10",
    types: "poi,address,place,street",
    access_token: MAPBOX_TOKEN,
  });
  if (proximity) params.set("proximity", `${proximity[0]},${proximity[1]}`);
  // 表示範囲に限定しないと、同名の施設が全国から混ざる（「ヤマト 営業所」で埼玉・千葉が出た）
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${params.toString()}`);
  if (!res.ok) throw new Error(`search ${res.status}`);
  return toHits(await res.json());
}

/**
 * 種別で近くを探す（ガソリンスタンド・駐車場など）。
 * 「この辺の給油所どこ」という調べ方は名前を知らないので、カテゴリ検索でないと引けない。
 */
async function searchCategory(
  category: string,
  proximity: [number, number] | null,
  bbox: string | null,
): Promise<GeocodeHit[]> {
  const params = new URLSearchParams({
    country: "jp",
    language: "ja",
    limit: "10",
    access_token: MAPBOX_TOKEN,
  });
  if (proximity) params.set("proximity", `${proximity[0]},${proximity[1]}`);
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(
    `https://api.mapbox.com/search/searchbox/v1/category/${encodeURIComponent(category)}?${params.toString()}`,
  );
  if (!res.ok) throw new Error(`category ${res.status}`);
  return toHits(await res.json());
}

type SearchBoxResponse = {
  features?: {
    id?: string;
    properties?: {
      name?: string;
      full_address?: string;
      place_formatted?: string;
      coordinates?: { latitude: number; longitude: number };
    };
    geometry?: { coordinates?: [number, number] };
  }[];
};

function toHits(json: SearchBoxResponse): GeocodeHit[] {
  return (json.features ?? [])
    .map((f, i) => {
      const c = f.properties?.coordinates;
      const g = f.geometry?.coordinates;
      const lat = c?.latitude ?? g?.[1];
      const lng = c?.longitude ?? g?.[0];
      if (lat == null || lng == null) return null;
      return {
        id: f.id ?? `hit-${i}`,
        name: f.properties?.name ?? "",
        address: f.properties?.full_address ?? f.properties?.place_formatted ?? "",
        lat,
        lng,
      };
    })
    .filter((h): h is GeocodeHit => h !== null && !!h.name);
}

/**
 * よく調べる種別のショートカット。
 * ガソリン・駐車場はカテゴリ検索、運送会社は名前で引く（ブランド名の方が確実に当たる）。
 */
const SEARCH_SHORTCUTS: { label: string; category?: string; query?: string; icon: PlaceIcon }[] = [
  { label: "ガソリン", category: "gas_station", icon: "fuel" },
  { label: "駐車場", category: "parking_lot", icon: "parking" },
  { label: "ヤマト運輸", query: "ヤマト運輸", icon: "client" },
  { label: "佐川急便", query: "佐川急便", icon: "client" },
  { label: "コンビニ", category: "convenience_store", icon: "pin" },
];

// 拠点ピンのマーカー種別（DB の map_places.icon と対応）。
const PLACE_ICONS = {
  pin: { label: "拠点", icon: faLocationDot, bg: "bg-violet-600" },
  warehouse: { label: "倉庫", icon: faWarehouse, bg: "bg-amber-600" },
  parking: { label: "駐車場", icon: faSquareParking, bg: "bg-blue-600" },
  client: { label: "取引先", icon: faBuilding, bg: "bg-emerald-600" },
  fuel: { label: "給油所", icon: faGasPump, bg: "bg-rose-600" },
} as const;
type PlaceIcon = keyof typeof PLACE_ICONS;

type MapPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  icon: PlaceIcon;
  /** point=1点 / circle=中心+半径（migration 124） */
  shape?: "point" | "circle" | "polygon";
  radius_m?: number | null;
};

type ParkingSlot = {
  id: string;
  place_id: string;
  label: string;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  bearing: number;
  lat: number;
  lng: number;
  vehicle_id: string | null;
};

type CourseArea = {
  id: string;
  name: string;
  color: string | null;
  delivery_area: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] } | null;
  delivery_area_updated_at: string | null;
};

type PolygonFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
};
type PolygonCollection = { type: "FeatureCollection"; features: PolygonFeature[] };

/**
 * 描いた多角形を「最小面積の長方形」に整える。
 * 駐車区画は長方形なので、ざっくり囲ってもらってこちらで矩形に直す
 *（4点をきっちり打たせるのは航空写真の上では難しい）。
 */
function snapToRectangle(ring: [number, number][]): [number, number][] {
  const pts = ring.slice(0, -1);
  if (pts.length < 3) return ring;
  const lat0 = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * (Math.PI / 180);
  const kx = Math.cos(lat0); // 経度方向の縮尺補正
  const xy = pts.map(([lng, lat]) => [lng * kx, lat] as [number, number]);

  let best: { area: number; corners: [number, number][] } | null = null;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cos = Math.cos(-ang);
    const sin = Math.sin(-ang);
    const rot = xy.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos] as [number, number]);
    const minX = Math.min(...rot.map((p) => p[0]));
    const maxX = Math.max(...rot.map((p) => p[0]));
    const minY = Math.min(...rot.map((p) => p[1]));
    const maxY = Math.max(...rot.map((p) => p[1]));
    const area = (maxX - minX) * (maxY - minY);
    if (best && area >= best.area) continue;
    const back = ([x, y]: [number, number]): [number, number] => {
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      return [(x * c - y * sn) / kx, x * sn + y * c];
    };
    best = {
      area,
      corners: [
        back([minX, minY]),
        back([maxX, minY]),
        back([maxX, maxY]),
        back([minX, maxY]),
      ],
    };
  }
  if (!best) return ring;
  return [...best.corners, best.corners[0]];
}

/** 「12番」→「13番」のように末尾の数字を1つ進める（区画は連番で入力することが多い）。 */
function nextSlotLabel(label: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(label);
  if (!m) return "";
  return `${m[1]}${Number(m[2]) + 1}${m[3]}`;
}

/** 点が多角形の中にあるか（レイキャスティング）。車の向きを区画に合わせる判定に使う。 */
function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 円を GeoJSON のポリゴンに落とす（Mapbox に円プリミティブが無いため）。 */
function circlePolygon(lat: number, lng: number, radiusM: number, steps = 64): PolygonFeature {
  const coords: [number, number][] = [];
  const latR = radiusM / 111_320;
  const lngR = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    coords.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

// 検索結果のピン。拠点ピン（登録済み）と区別できるよう、白地＋番号＋種別アイコンにする。
function SearchHitMarker({ index, icon, active }: { index: number; icon: PlaceIcon; active: boolean }) {
  const meta = PLACE_ICONS[icon] ?? PLACE_ICONS.pin;
  return (
    <div className="flex flex-col items-center">
      <div
        className={`flex items-center gap-1 rounded-full border-2 bg-white px-2 py-1 shadow-lg transition-transform ${
          active ? "scale-110 border-slate-900" : "border-white"
        }`}
      >
        <FontAwesomeIcon icon={meta.icon} className={`h-3 w-3 ${meta.bg.replace("bg-", "text-")}`} />
        <span className="text-[10px] font-bold text-slate-700">{index}</span>
      </div>
      <div className="h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-white" />
    </div>
  );
}

// 拠点ピンの見た目: 白縁の丸バッジ＋種別アイコン。
function PlaceMarkerBadge({ icon }: { icon: PlaceIcon }) {
  const meta = PLACE_ICONS[icon] ?? PLACE_ICONS.pin;
  return (
    <div
      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white shadow-md ${meta.bg}`}
    >
      <FontAwesomeIcon icon={meta.icon} className="h-3.5 w-3.5 text-white" />
    </div>
  );
}

type MapVehicle = VehiclePlateData & {
  /** 地図の3Dモデル識別子（未設定は既定モデル）。migration 123 */
  model_key?: string | null;
  /** 車体色 #RRGGBB（未設定はモデル本来の色）。migration 123 */
  body_color?: string | null;
  position: {
    lat: number;
    lng: number;
    at: string | null;
    kind: "checkin" | "checkout" | "manual" | "gps";
    source?: "punch" | "manual" | "gps";
    placedBy?: string;
    note?: string | null;
    sessionStatus: "open" | "closed";
    driverName: string;
  } | null;
};

type MapOperationsData = {
  movements: VehicleMovement[];
  places: { id: string; name: string; lat: number; lng: number }[];
  drivers: { id: string; name: string }[];
  upcomingUses: {
    id: string;
    vehicleId: string;
    shiftDate: string;
    meetingTime: string | null;
    driver: { id: string; name: string } | null;
    course: { id: string; name: string } | null;
    cycleNo: number;
    slot: number;
  }[];
};

type MapMode = "current" | "movements" | "history";

type MovementFormState = {
  id: string | null;
  expectedVersion: number | null;
  vehicleId: string;
  fromPlaceId: string;
  toPlaceId: string;
  assigneeDriverId: string;
  dueDate: string;
  dueTime: string;
  note: string;
};

function dateTimeInJst(value: string): { date: string; time: string } {
  const [date, time] = new Date(value)
    .toLocaleString("sv-SE", { timeZone: "Asia/Tokyo", hour12: false })
    .split(" ");
  return { date, time: time.slice(0, 5) };
}

function movementStatusLabel(movement: VehicleMovement): string {
  if (movement.actualPlaceId && movement.actualPlaceId !== movement.toPlaceId) return "到着場所を確認";
  if (movement.status === "needed") return "手配が必要";
  if (movement.status === "planned" && Date.parse(movement.dueAt) < Date.now()) return "期限を確認";
  return "手配済み";
}

function formatMovementAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShiftDay(value: string): string {
  const date = reportDateStrToDate(value);
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
}

function MovementDetailCard({
  movement,
  vehicle,
  upcomingUse,
  places,
  canDispatch,
  completing,
  completionPlaceId,
  saving,
  error,
  onEdit,
  onStartComplete,
  onCompletionPlaceChange,
  onComplete,
  onCancelComplete,
  onCancel,
}: {
  movement: VehicleMovement | null;
  vehicle: MapVehicle | null;
  upcomingUse: MapOperationsData["upcomingUses"][number] | null;
  places: MapOperationsData["places"];
  canDispatch: boolean;
  completing: boolean;
  completionPlaceId: string;
  saving: boolean;
  error: string;
  onEdit: () => void;
  onStartComplete: () => void;
  onCompletionPlaceChange: (value: string) => void;
  onComplete: () => void;
  onCancelComplete: () => void;
  onCancel: () => void;
}) {
  if (!movement || !vehicle) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">車両を選んでください</div>;
  }
  const attention = movementNeedsAttention(movement);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <VehiclePlate vehicle={vehicle} compact className="w-28 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{vehicle.brand || "車両"}</p>
          <span
            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              attention ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {attention && <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />}
            {movementStatusLabel(movement)}
          </span>
        </div>
      </div>

      <dl className="mt-4 space-y-3 text-xs">
        <div>
          <dt className="font-semibold text-slate-400">移動</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 font-bold text-slate-800">
            <span>{movement.fromPlace?.name ?? "出発地不明"}</span>
            <FontAwesomeIcon icon={faArrowRight} className="h-3 w-3 text-amber-600" />
            <span>{movement.toPlace?.name ?? "届け先不明"}</span>
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="font-semibold text-slate-400">届ける期限</dt>
            <dd className="mt-0.5 font-semibold text-slate-800">{formatMovementAt(movement.dueAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-400">運ぶ人</dt>
            <dd className={`mt-0.5 font-semibold ${movement.assignee ? "text-slate-800" : "text-amber-700"}`}>
              {movement.assignee?.name ?? "未設定"}
            </dd>
          </div>
        </div>
        <div>
          <dt className="font-semibold text-slate-400">次の利用</dt>
          <dd className="mt-0.5 leading-5 text-slate-700">
            {upcomingUse ? (
              <>
                {formatShiftDay(upcomingUse.shiftDate)} {upcomingUse.meetingTime?.slice(0, 5) || "時刻未設定"}
                <br />
                {[upcomingUse.driver?.name, upcomingUse.course?.name].filter(Boolean).join("・") || "利用者未設定"}
              </>
            ) : (
              "直近14日にはありません"
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-400">最後の位置記録</dt>
          <dd className="mt-0.5 text-slate-700">
            {vehicle.position
              ? `${formatAt(vehicle.position.at)}${vehicle.position.driverName ? `・${vehicle.position.driverName}` : ""}`
              : "未記録"}
          </dd>
        </div>
      </dl>

      {movement.note && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{movement.note}</p>}
      {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}

      {canDispatch && !completing && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="min-h-11 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            手配を変更
          </button>
          <button
            type="button"
            onClick={onStartComplete}
            className="min-h-11 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <FontAwesomeIcon icon={faCheck} className="mr-1.5 h-3 w-3" />
            完了を記録
          </button>
          <button type="button" onClick={onCancel} className="col-span-2 text-xs text-red-600 underline underline-offset-2">
            この手配を取り消す
          </button>
        </div>
      )}

      {canDispatch && completing && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <label className="block text-xs font-bold text-emerald-900" htmlFor="movement-arrival-place">
            実際に停めた場所
          </label>
          <select
            id="movement-arrival-place"
            value={completionPlaceId}
            onChange={(event) => onCompletionPlaceChange(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-emerald-300 bg-white px-3 text-sm"
          >
            <option value="">選んでください</option>
            {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
          </select>
          <p className="mt-1 text-[11px] leading-5 text-emerald-800">
            予定と違う場所も記録できます。その場合、手配は完了にせず確認を残します。
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={onCancelComplete} className="min-h-11 rounded-lg text-xs font-semibold text-slate-600">
              戻る
            </button>
            <button
              type="button"
              disabled={!completionPlaceId || saving}
              onClick={onComplete}
              className="min-h-11 rounded-lg bg-emerald-700 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? "記録中..." : "この場所で記録"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** つまみに出す短い番号（一連指定番号だけ）。 */
function plateShort(v: MapVehicle): string {
  return formatPlateNumeric(v.number_numeric || "") || v.brand?.slice(0, 4) || "車";
}

/** 通知メッセージ用の短いプレート表記。 */
function plateText(v: MapVehicle): string {
  return (
    [v.number_class, v.number_hiragana, formatPlateNumeric(v.number_numeric || "")]
      .filter(Boolean)
      .join(" ") ||
    v.brand ||
    "車両"
  );
}

function formatAt(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

// 吹き出しの中身: ナンバープレート＋状態（稼働中/最終確認）。
function VehiclePopup({ vehicle }: { vehicle: MapVehicle }) {
  const p = vehicle.position!;
  const working = p.sessionStatus === "open";
  return (
    <div className="w-[200px] space-y-1.5 p-1">
      <VehiclePlate vehicle={vehicle} glow={false} className="!max-w-[200px]" />
      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
        <span
          className={`inline-block h-2 w-2 rounded-full ${working ? "bg-emerald-500" : "bg-slate-400"}`}
        />
        {p.source === "manual"
          ? `${formatAt(p.at)} に手動で配置${p.placedBy ? `（${p.placedBy}）` : ""}`
          : working
            ? `稼働中${p.driverName ? `（${p.driverName} さん）` : ""}・${formatAt(p.at)} 出勤打刻`
            : `${formatAt(p.at)} ${p.kind === "checkout" ? "退勤" : "出勤"}打刻の位置`}
      </div>
    </div>
  );
}

// 車両の状態と表示色。稼働セッション＋拠点との距離から導出する。
// 「積み込み中」は専用の記録が無いので、**拠点（倉庫・拠点ピン）に停まっている稼働中**を
// そう見なす（ユーザー案 2026-08-10）。あくまで推定なので断定的な表現は避ける。
const VEHICLE_STATUS_DOT = {
  稼働中: "bg-emerald-500",
  積み込み中: "bg-amber-400",
  稼働外: "bg-slate-500",
} as const;
type VehicleStatus = keyof typeof VEHICLE_STATUS_DOT;

/** 拠点に「停まっている」と見なす距離（m）。敷地の広さを考えて少し広めに取る。 */
const AT_PLACE_RADIUS_M = 120;

/** 2点間の概算距離（m）。数百m の判定にしか使わないので簡易式で十分。 */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// 車両の頭上ラベル: 吹き出し用に最適化した簡易プレート。黒ナンバー（事業用軽貨物）
// らしく黒地に黄文字。実車プレートの再現は popup 側の VehiclePlate に任せる。
// TODO: 数字・かなは将来 SVG グリフ化する（docs/roadmap-2026-07.md 参照）。
function VehicleLabel({
  vehicle,
  status,
  selected = false,
}: {
  vehicle: VehiclePlateData;
  status: VehicleStatus;
  selected?: boolean;
}) {
  return (
    <>
      {/* 通常表示（吹き出し）。重なって負けたら .vl-collapsed でドットに縮退する */}
      <div className="vl-full flex flex-col items-center">
        <div
          className={`relative min-w-[72px] rounded-lg bg-slate-950/95 px-2 py-1 text-center shadow-md ring-2 ${
            selected ? "ring-amber-400" : "ring-white/10"
          }`}
        >
          <div
            className="text-[8px] font-semibold leading-none tracking-[0.14em]"
            style={{ color: "#e8d44d" }}
          >
            {vehicle.number_prefix || ""} {vehicle.number_class || ""}
          </div>
          <div
            className="mt-0.5 flex items-baseline justify-center gap-0.5 leading-none"
            style={{ color: "#e8d44d" }}
          >
            <span className="text-[10px] font-bold">{vehicle.number_hiragana || ""}</span>
            <span className="text-[15px] font-black tracking-wide">
              {formatPlateNumeric(vehicle.number_numeric || "")}
            </span>
          </div>
          {/* 状態は色で示す（全車が同じ文字を並べても情報量が無いため）。
              稼働外は既定なので文字を出さない。 */}
          <span
            className={`absolute -right-1 -top-1 block h-2.5 w-2.5 rounded-full border border-slate-950 ${VEHICLE_STATUS_DOT[status]}`}
          />
          {status !== "稼働外" && (
            <div className="mt-0.5 text-[8px] font-bold leading-none text-slate-300">{status}</div>
          )}
        </div>
        <div className="h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-slate-950" />
      </div>
      {/* 縮退表示: 状態色ドット（存在と状態だけは常に示す） */}
      <div className="vl-dot flex flex-col items-center">
        <span
          className={`block h-3 w-3 rounded-full border-2 border-white shadow-md ${VEHICLE_STATUS_DOT[status]}`}
        />
      </div>
    </>
  );
}

// 設定モーダルのスイッチ行。
function SwitchRow({
  label,
  note,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-1.5 ${disabled ? "opacity-40" : ""}`}
    >
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {note && <div className="text-[11px] text-slate-400">{note}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-violet-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export default function MapPage() {
  /** 配置モード。ON の間だけピンを掴める（地図のパンを止めるので誤操作しない） */
  const [placing, setPlacing] = useState(false);
  /** 現在・移動予定・過去の事実を同じ地図に混ぜないための表示モード。 */
  const [mapMode, setMapMode] = useState<MapMode>("current");
  /** 履歴モード（Stage 0.6）。null = ライブ（現在） */
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  /** 履歴モードの時刻。存在しない中間位置を連続表示しないため明示入力にする。 */
  const [historyTime, setHistoryTime] = useState("12:00");

  // 履歴モードでは as-of（その時刻の位置）を取りに行く。ライブは従来どおり最新。
  const asOfIso = useMemo(() => {
    if (!historyDate) return null;
    return new Date(`${historyDate}T${historyTime}:00+09:00`).toISOString();
  }, [historyDate, historyTime]);

  const { data, isLoading, mutate } = useApi<{
    vehicles: MapVehicle[];
    asOf: string | null;
    historyNeighbors: { previousAt: string | null; nextAt: string | null } | null;
  }>(
    asOfIso ? `/api/admin/map/vehicles?at=${encodeURIComponent(asOfIso)}` : "/api/admin/map/vehicles",
    // 履歴は勝手に更新されない方が読みやすい（ライブだけ自動更新）
    { refreshInterval: asOfIso ? 0 : 60000, keepPreviousData: true },
  );
  const historyNeighbors = data?.asOf === asOfIso ? data.historyNeighbors : null;
  const selectHistoryAt = (at: string) => {
    const [date, time] = new Date(at)
      .toLocaleString("sv-SE", { timeZone: "Asia/Tokyo", hour12: false })
      .split(" ");
    setHistoryDate(date);
    setHistoryTime(time.slice(0, 5));
  };
  const { data: placesData, refresh: refreshPlaces } = useApi<{ places: MapPlace[] }>(
    "/api/admin/map/places",
  );
  const places = useMemo(() => placesData?.places ?? [], [placesData]);

  // 駐車区画（migration 126）。出発地＝稼働開始を押す場所の正体
  const { data: slotData, refresh: refreshSlots } = useApi<{ slots: ParkingSlot[] }>(
    "/api/admin/map/parking-slots",
  );
  const slots = useMemo(() => slotData?.slots ?? [], [slotData]);
  /** 区画を描いている拠点。null = 描いていない */
  const [slotPlace, setSlotPlace] = useState<MapPlace | null>(null);
  const [slotLabel, setSlotLabel] = useState("");
  const [slotVehicleId, setSlotVehicleId] = useState("");
  const [slotSaving, setSlotSaving] = useState(false);
  const [slotError, setSlotError] = useState("");

  // 配達エリア（コースの属性・migration 125）
  const { data: courseAreaData, refresh: refreshCourseAreas } = useApi<{ courses: CourseArea[] }>(
    "/api/admin/map/course-areas",
  );
  const courseAreas = useMemo(() => courseAreaData?.courses ?? [], [courseAreaData]);
  /** エリアを編集中のコース。null = 編集していない */
  const [editingAreaCourse, setEditingAreaCourse] = useState<CourseArea | null>(null);
  const [areaSaving, setAreaSaving] = useState(false);
  const [areaError, setAreaError] = useState("");
  const [areaPanelOpen, setAreaPanelOpen] = useState(false);
  const drawRef = useRef<MapboxDraw | null>(null);

  const located = useMemo(
    () => (data?.vehicles ?? []).filter((v) => v.position != null),
    [data],
  );
  const unlocated = useMemo(
    () => (data?.vehicles ?? []).filter((v) => v.position == null),
    [data],
  );
  const unlocatedCount = unlocated.length;
  /** 「地図をクリックして置く」対象に選んだ車両。位置がまだ無い車はドラッグできないため、この導線が要る */
  const [pendingPlaceVehicle, setPendingPlaceVehicle] = useState<MapVehicle | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  // 位置のドラッグ配置は配車権限を持つ人だけ（設計: docs/design/map-board.md）
  const [canDispatch, setCanDispatch] = useState(false);
  const [canViewShifts, setCanViewShifts] = useState(false);
  /** 拠点ピンの追加権限（API 側は can_manage_org_settings） */
  const [canWritePlaces, setCanWritePlaces] = useState(false);
  useEffect(() => {
    setCanDispatch(hasCapability("can_dispatch"));
    setCanViewShifts(hasCapability("can_view_shifts"));
    const writePlaces = hasCapability("can_manage_org_settings");
    setCanWritePlaces(writePlaces);
    canWritePlacesRef.current = writePlaces;
  }, []);
  const {
    data: operationsData,
    error: operationsError,
    isLoading: operationsLoading,
    mutate: mutateOperations,
  } = useApi<MapOperationsData>(
    canViewShifts ? "/api/admin/map/movements" : null,
    { refreshInterval: mapMode === "movements" ? 60000 : 0 },
  );
  const activeMovements = useMemo(
    () => (operationsData?.movements ?? []).filter(needsVehicleRelocation),
    [operationsData],
  );
  const movementVehicleIds = useMemo(
    () => new Set(activeMovements.map((movement) => movement.vehicleId)),
    [activeMovements],
  );
  const displayedVehicles = useMemo(
    () => (mapMode === "movements" ? located.filter((vehicle) => movementVehicleIds.has(vehicle.id)) : located),
    [located, mapMode, movementVehicleIds],
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const selectedMovement = useMemo(
    () =>
      activeMovements.find((movement) => movement.vehicleId === selectedVehicleId) ??
      activeMovements[0] ??
      null,
    [activeMovements, selectedVehicleId],
  );
  const selectedVehicle = useMemo(
    () => (data?.vehicles ?? []).find((vehicle) => vehicle.id === (selectedMovement?.vehicleId ?? selectedVehicleId)) ?? null,
    [data, selectedMovement, selectedVehicleId],
  );
  const selectedUpcomingUse = useMemo(
    () =>
      (operationsData?.upcomingUses ?? []).find(
        (use) => use.vehicleId === (selectedMovement?.vehicleId ?? selectedVehicleId),
      ) ?? null,
    [operationsData, selectedMovement, selectedVehicleId],
  );
  const [movementForm, setMovementForm] = useState<MovementFormState | null>(null);
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementError, setMovementError] = useState("");
  const [completionPlaceId, setCompletionPlaceId] = useState("");
  const [completingMovement, setCompletingMovement] = useState(false);
  const [cancelMovement, setCancelMovement] = useState<VehicleMovement | null>(null);
  const [placingMessage, setPlacingMessage] = useState<string | null>(null);
  const popupRootsRef = useRef<Root[]>([]);
  const placeMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const placeRootsRef = useRef<Root[]>([]);
  const fittedRef = useRef(false);
  // 3D 状態はボタンで持たず、地図の実ピッチから導出する（コンパス等どこから
  // 変わってもトグル表示が追従する）。
  const [pitch, setPitch] = useState(0);
  const is3D = pitch > 5;
  const vehicleLabelMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const vehicleLabelRootsRef = useRef<Root[]>([]);
  /** 吹き出しの重なり回避。データ更新後にも呼べるよう ref で保持する */
  const declutterPlatesRef = useRef<() => void>(() => {});
  /** 3Dモデルのソースへ最新の車両位置を流し込む（スタイル再読込時にも呼ぶ） */
  const applyVehicleModelDataRef = useRef<() => void>(() => {});
  /** 面（駐車区画・配達エリア・拠点の円）のデータを流し込む（同上） */
  const applyAreaDataRef = useRef<() => void>(() => {});

  // 拠点ピンは基本非表示。設定モーダルからオンにできる。
  const [showPlaces, setShowPlaces] = useState(false);
  const showPlacesRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 共有ビュー（配車作戦盤 Stage 1）: 参加者の在席・カーソル・視点追従を Realtime で同期。
  const [shareOn, setShareOn] = useState(false);
  const [selfName] = useState(() => getStoredDriver()?.name ?? "運営");
  const share = useSharedMapView({ getMap: () => mapRef.current, selfName, active: shareOn });

  // 地図表示の設定（ベースマップ・ラベル・3D）。
  const [viewPrefs, setViewPrefs] = useState<MapViewPrefs>(loadViewPrefs);
  const viewPrefsRef = useRef(viewPrefs);
  const currentBasemapRef = useRef(viewPrefs.basemap);

  // 設定を地図へ反映する（style.load 後にも呼ばれる。ベースマップ切替は別処理）。
  const applyViewPrefs = () => {
    const map = mapRef.current;
    if (!map) return;
    const p = viewPrefsRef.current;
    try {
      map.setConfigProperty("basemap", "showPlaceLabels", p.placeLabels);
      map.setConfigProperty("basemap", "showRoadLabels", p.roadLabels);
      map.setConfigProperty("basemap", "showPointOfInterestLabels", p.poiLabels);
      map.setConfigProperty("basemap", "showTransitLabels", p.transitLabels);
      // 航空写真スタイルは 3D オブジェクトのトグル未対応のためスキップ。
      if (p.basemap === "standard") {
        map.setConfigProperty("basemap", "show3dObjects", p.objects3d);
      }
      if (p.terrain) {
        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.2 });
      } else if (map.getTerrain()) {
        map.setTerrain(null);
      }
    } catch {
      // スタイル読込中などは style.load 後に再適用されるため無視してよい
    }
  };
  const applyViewPrefsRef = useRef(applyViewPrefs);
  applyViewPrefsRef.current = applyViewPrefs;

  useEffect(() => {
    viewPrefsRef.current = viewPrefs;
    try {
      localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(viewPrefs));
    } catch {
      // localStorage が使えない環境では保存を諦める（表示には影響しない）
    }
    const map = mapRef.current;
    if (!map) return;
    if (currentBasemapRef.current !== viewPrefs.basemap) {
      // ベースマップはスタイルごと差し替え。style.load でライティング・
      // トラックモデル・この設定が再適用される。
      currentBasemapRef.current = viewPrefs.basemap;
      map.setStyle(styleUrlFor(viewPrefs.basemap));
    } else {
      applyViewPrefs();
    }
    // applyViewPrefs は ref 経由でしか状態を読まない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPrefs]);

  // 地点検索（住所・施設名 → 座標）。クリックで置くだけだと、住所しか分からない拠点を置けない。
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  /** ショートカット検索で選ばれた種別（結果から拠点を作るとき、この種別を初期選択にする） */
  const [searchIconHint, setSearchIconHint] = useState<PlaceIcon>("pin");
  /** 直近の検索条件（「このエリアを再検索」で使い回す） */
  const [lastSearch, setLastSearch] = useState<
    { kind: "text"; value: string; icon: PlaceIcon } | { kind: "category"; value: string; icon: PlaceIcon } | null
  >(null);
  /** 検索後に地図を動かしたか（Google マップの「このエリアを検索」と同じ考え方） */
  const [movedSinceSearch, setMovedSinceSearch] = useState(false);
  /** 一覧でホバー中の候補。地図上のピンを強調する */
  const [hoveredHitId, setHoveredHitId] = useState<string | null>(null);
  /** 宣言順の都合で effect から呼ぶための参照 */
  const runSearchRef = useRef<(spec: { kind: "text" | "category"; value: string; icon: PlaceIcon }) => void>(
    () => {},
  );

  // ピン追加フロー: adding=クリック待ち → draft=位置決定・名称入力中。
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState<PlaceIcon>("pin");
  const [draftError, setDraftError] = useState("");
  /** 編集中の拠点（名称・種別・位置・範囲）。null = 編集していない */
  const [editingPlace, setEditingPlace] = useState<MapPlace | null>(null);
  const [savingPlace, setSavingPlace] = useState(false);
  const [placeEditError, setPlaceEditError] = useState("");
  const editingPlaceRef = useRef<MapPlace | null>(null);
  editingPlaceRef.current = editingPlace;
  const canWritePlacesRef = useRef(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MapPlace | null>(null);

  // 拠点ピンの表示は手動トグルのみ（ズーム連動の自動非表示は「消えるのが早すぎる」
  // ため廃止。ピンは吹き出しほど邪魔にならないので常時表示で問題ない）。
  const applyPlacesVisibility = () => {
    const visible = showPlacesRef.current;
    placeMarkersRef.current.forEach((m) => {
      const el = m.getElement();
      // opacity は使わない（mapbox が3D遮蔽判定で毎フレーム上書きし、
      // 非表示が巻き戻るバグになる）。mapbox が触らない visibility で制御する。
      el.style.visibility = visible ? "" : "hidden";
      el.style.pointerEvents = visible ? "" : "none";
      if (!visible && (m.getPopup()?.isOpen() ?? false)) m.togglePopup();
    });
  };
  // zoom リスナーには ref 経由で常に最新の関数を届ける（HMR・stale クロージャ対策）。
  const applyPlacesVisibilityRef = useRef(applyPlacesVisibility);
  applyPlacesVisibilityRef.current = applyPlacesVisibility;

  useEffect(() => {
    showPlacesRef.current = showPlaces;
    applyPlacesVisibility();
    // applyPlacesVisibility は ref 経由でしか状態を読まないため依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlaces]);

  useEffect(() => {
    addingRef.current = adding;
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = adding ? "crosshair" : "";
  }, [adding]);

  // 入力が落ち着いてから検索する（1文字ごとに叩かない）。
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return; // 空にしただけでは結果を消さない（ショートカットの結果を保つ）
    const timer = setTimeout(() => {
      void runSearchRef.current({ kind: "text", value: q, icon: "pin" });
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  /** 検索の実行（テキスト／カテゴリ共通）。範囲は常にいまの表示範囲。 */
  const runSearch = useCallback(
    async (spec: { kind: "text" | "category"; value: string; icon: PlaceIcon }) => {
      const center = mapRef.current?.getCenter();
      const proximity: [number, number] | null = center ? [center.lng, center.lat] : null;
      const b = mapRef.current?.getBounds();
      const bbox = b
        ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(",")
        : null;
      setSearchIconHint(spec.icon);
      setLastSearch(spec);
      setSearching(true);
      setMovedSinceSearch(false);
      try {
        const hits =
          spec.kind === "category"
            ? await searchCategory(spec.value, proximity, bbox)
            : await searchPlaces(spec.value, proximity, bbox);
        setSearchResults(hits);
      } catch (e) {
        console.error("[map] search error", e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [],
  );

  runSearchRef.current = (spec) => void runSearch(spec);

  /** ショートカット（ガソリン・駐車場・ヤマト運輸など）で、いま見ている辺りを探す。 */
  const runShortcut = (sc: (typeof SEARCH_SHORTCUTS)[number]) => {
    setSearchQuery("");
    void runSearch(
      sc.category
        ? { kind: "category", value: sc.category, icon: sc.icon }
        : { kind: "text", value: sc.query ?? sc.label, icon: sc.icon },
    );
  };

  const pickSearchResultRef = useRef<(hit: GeocodeHit) => void>(() => {});

  /** 検索結果を選ぶ: その場所へ寄って、拠点の下書きにする（名称も埋める）。 */
  const pickSearchResult = (hit: GeocodeHit) => {
    setAdding(false);
    setDraft({ lat: hit.lat, lng: hit.lng });
    setDraftName((prev) => prev || hit.name);
    setDraftIcon(searchIconHint); // ガソリン→給油所 のように種別まで引き継ぐ
    setSearchResults([]);
    setSearchQuery("");
    mapRef.current?.flyTo({ center: [hit.lng, hit.lat], zoom: 16, duration: 800 });
  };

  pickSearchResultRef.current = pickSearchResult;

  /** 拠点の編集を開始する（その場所へ寄せて、パネルを出す）。 */
  const openPlaceEditor = (place: MapPlace) => {
    setEditingPlace(place);
    setSearchResults([]);
    mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: Math.max(mapRef.current.getZoom(), 15), duration: 600 });
  };

  /** 編集内容を保存する。 */
  const savePlaceEdit = async () => {
    if (!editingPlace || savingPlace) return;
    const name = editingPlace.name.trim();
    if (!name) return;
    setSavingPlace(true);
    setPlaceEditError("");
    try {
      await apiFetch(`/api/admin/map/places/${editingPlace.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          icon: editingPlace.icon,
          lat: editingPlace.lat,
          lng: editingPlace.lng,
          radiusM: editingPlace.radius_m ?? 0,
        }),
      });
      setEditingPlace(null);
      void refreshPlaces();
    } catch (e) {
      console.error(e);
      setPlaceEditError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSavingPlace(false);
    }
  };

  // Esc でピン追加を中止。
  useEffect(() => {
    if (!adding && !draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAdding(false);
        setDraft(null);
        setDraftError("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, draft]);

  // 地図の初期化（トークンがある時のみ）。
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      // Standard 系スタイル: ズーム14.5前後から建物が3Dで立ち上がる。
      style: styleUrlFor(viewPrefsRef.current.basemap),
      center: [135.76, 35.01], // 位置データが無い間のフォールバック（近畿圏）
      zoom: 8,
      maxPitch: 85,
      language: "ja",
      // 帰属表示は規約上必須のため消せない。ⓘ アイコンへ畳むコンパクト表示は
      // 公式に許可されているのでそれを使う（ロゴは表示のまま）。
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    // ピッチをUIへ同期（トグルがコンパス操作等にも追従する）。
    map.on("pitch", () => setPitch(map.getPitch()));

    // ピン追加モード中のクリックで位置を確定。
    map.on("click", (e) => {
      if (!addingRef.current) return;
      setDraft({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      setAdding(false);
    });

    // 時間帯ライティングを現在時刻から自動適用。10分ごとに再判定する。
    const applyLight = () => {
      map.setConfigProperty("basemap", "lightPreset", presetForHour(new Date().getHours()));
    };
    map.on("style.load", applyLight);
    const lightTimer = setInterval(applyLight, 10 * 60 * 1000);

    // ラベル・3D・地形などの表示設定を適用（設定モーダルから変更可能）。
    map.on("style.load", () => applyViewPrefsRef.current());

    // 車両の3Dモデル。**中身は実データ**（位置が記録された車両）で、下の effect から流し込む。
    // モデルは Kenney Car Kit の delivery van（CC0）。実寸 3.25×1.5×1.65m で
    // 軽バンとほぼ同寸・原点は底面中心（テクスチャ埋め込み済み）。
    const addTruckModel = () => {
      if (map.getLayer("truck-3d")) return;
      // 車種は vehicles.model_key で選ぶ（migration 123）。未設定は既定モデル。
      // 実車ベースのモデルは Meshy 生成 → scripts/prepare-vehicle-glb.mjs で整形したもの。
      for (const [id, url] of Object.entries(VEHICLE_MODEL_URLS)) map.addModel(id, url);
      map.addModel("truck", "/models/truck.glb"); // 旧・汎用（既存データの後方互換）
      map.addSource("truck-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "truck-3d",
        type: "model",
        source: "truck-src",
        // 車種の出し分け。未知のキーは既定モデルに落とす
        layout: { "model-id": ["coalesce", ["get", "model"], DEFAULT_VEHICLE_MODEL_KEY] },
        paint: {
          "model-rotation": ["get", "rotation"], // 駐車の向き（feature ごと）
          // 車体色は車両ごとの属性（vehicles.body_color）。白＝着色なし
          "model-color": ["get", "color"],
          // モデルは「塗り分けマスク」付き（窓・タイヤが暗い）。強く混ぜると窓まで塗り潰すので抑える
          "model-color-mix-intensity": 0.45,
          // 夜のライティングでも沈まないよう自己発光させる（マーカーと同じ扱い）。
          "model-emissive-strength": 1,
        },
      });
      updateTruckScale();
      // スタイル再読込のたびにソースは空で作り直されるので、その場で最新データを流し込む
      applyVehicleModelDataRef.current();
    };
    // 見かけサイズ: ズーム9〜18では画面上ほぼ一定（基準=実寸の1.6倍）。
    // さらに寄ると等倍まで縮み、以降は実寸に固定（駐車区画に正しく収まって見える）。
    // 9より引いたら拡大を打ち切る（巨大化防止）。
    const truckScaleAt = (zoom: number) => {
      const z = Math.min(Math.max(zoom, 9), 20);
      return Math.max(1, 1.6 * Math.pow(2, 18 - z));
    };
    const updateTruckScale = () => {
      if (!map.getLayer("truck-3d")) return;
      const s = truckScaleAt(map.getZoom());
      map.setPaintProperty("truck-3d", "model-scale", [s, s, s]);
    };
    map.on("style.load", addTruckModel);
    map.on("zoom", updateTruckScale);

    // 面のレイヤー（駐車区画・配達エリア・拠点の円）はここで**空のまま**作っておく。
    // データ側の effect で addSource すると、航空写真への切替（setStyle）でソースごと消え、
    // 「保存したのに区画が出ない」状態になっていた（2026-08-10 実機指摘）。
    // 3Dモデルと同じく「style.load で作り直し → ref でデータを流す」に揃える。
    const empty = { type: "FeatureCollection" as const, features: [] };
    const addAreaLayers = () => {
      // スタイル読込前に addSource すると "Style is not done loading" で throw し、
      // 地図の初期化ごと止まって**画面が出なくなる**（2026-08-10 実機）。必ず確認してから触る。
      if (!map.isStyleLoaded()) return;
      if (!map.getSource("place-areas")) {
        map.addSource("place-areas", { type: "geojson", data: empty as never });
        map.addLayer({
          id: "place-areas-fill",
          type: "fill",
          source: "place-areas",
          paint: { "fill-color": "#7c3aed", "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "place-areas-line",
          type: "line",
          source: "place-areas",
          paint: { "line-color": "#7c3aed", "line-width": 1.5, "line-opacity": 0.7 },
        });
      }
      if (!map.getSource("course-areas")) {
        map.addSource("course-areas", { type: "geojson", data: empty as never });
        map.addLayer({
          id: "course-areas-fill",
          type: "fill",
          source: "course-areas",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 },
        });
        map.addLayer({
          id: "course-areas-line",
          type: "line",
          source: "course-areas",
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.85 },
        });
        map.addLayer({
          id: "course-areas-label",
          type: "symbol",
          source: "course-areas",
          layout: { "text-field": ["get", "name"], "text-size": 12 },
          paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        });
      }
      if (!map.getSource("vehicle-lights")) {
        // 夜だけ灯る車両のライト。**稼働中の車だけ**光らせる＝「まだ外に出ている車」が一目で分かる。
        // 単なる演出ではなく情報にする（2026-08-11）。
        map.addSource("vehicle-lights", { type: "geojson", data: empty as never });
        map.addLayer({
          id: "vehicle-lights-glow",
          type: "circle",
          source: "vehicle-lights",
          paint: {
            "circle-color": "#ffd9a0",
            "circle-blur": 1,
            "circle-opacity": 0.55,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 18, 20, 44],
          },
        });
        map.addLayer({
          id: "vehicle-lights-core",
          type: "circle",
          source: "vehicle-lights",
          paint: {
            "circle-color": "#fff4de",
            "circle-opacity": 0.9,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 4, 20, 9],
          },
        });
      }
      if (!map.getSource("parking-slots")) {
        map.addSource("parking-slots", { type: "geojson", data: empty as never });
        map.addLayer({
          id: "parking-slots-fill",
          type: "fill",
          source: "parking-slots",
          paint: { "fill-color": "#38bdf8", "fill-opacity": 0.18 },
        });
        map.addLayer({
          id: "parking-slots-line",
          type: "line",
          source: "parking-slots",
          paint: { "line-color": "#e0f2fe", "line-width": 1.5, "line-opacity": 0.95 },
        });
        map.addLayer({
          id: "parking-slots-label",
          type: "symbol",
          source: "parking-slots",
          layout: { "text-field": ["get", "label"], "text-size": 11 },
          paint: { "text-color": "#0c4a6e", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        });
      }
      // スタイル差し替え直後は空なので、保持しているデータを流し直す
      applyAreaDataRef.current();
    };
    map.on("style.load", addAreaLayers);
    if (map.isStyleLoaded()) addAreaLayers();

    // プレート吹き出しは実データから作る（下の「車両ラベル反映」effect）。
    // 吹き出しの基本オフセット: 車両の画面上の高さに比例させる
    // （ズーム18まで一定、以降は実寸固定で画面上大きくなるのに追従）。
    const plateBaseOffset = () => {
      const z = Math.min(map.getZoom(), 22);
      return (30 * (truckScaleAt(z) * Math.pow(2, z - 18))) / 1.6;
    };

    // プレート吹き出しの重なり回避: 位置は動かさず（その場表示）、被ったら
    // 画面の下側＝体感的に手前の車両だけ吹き出しを出し、負けた側は
    // 状態色ドットに縮退する（存在は常に示す。消すと台数を誤認するため）。
    const declutterPlates = () => {
      const base = plateBaseOffset();
      const items = vehicleLabelMarkersRef.current.map((m) => ({
        m,
        pos: map.project(m.getLngLat()),
      }));
      items.sort((a, b) => b.pos.y - a.pos.y); // 下（手前）を優先
      const kept: { x: number; y: number }[] = [];
      for (const { m, pos } of items) {
        const collide = kept.some(
          (p) => Math.abs(p.x - pos.x) < 104 && Math.abs(p.y - pos.y) < 92,
        );
        m.setOffset([0, collide ? -6 : -base]);
        m.getElement().classList.toggle("vl-collapsed", collide);
        if (!collide) kept.push({ x: pos.x, y: pos.y });
      }
    };
    declutterPlatesRef.current = declutterPlates;
    map.on("moveend", declutterPlates);
    map.on("zoom", declutterPlates);

    // Option(Alt)+スクロールでカメラ微調整: 縦=傾き / 横=方角。
    // トラックパッドの2本指スクロールで安定して動かせる（capture で先取りし
    // ズームに食われないようにする）。
    const container = containerRef.current;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      map.setPitch(Math.min(85, Math.max(0, map.getPitch() - e.deltaY * 0.2)));
      if (e.deltaX !== 0) map.setBearing(map.getBearing() + e.deltaX * 0.3);
    };
    container.addEventListener("wheel", onWheel, { passive: false, capture: true });

    mapRef.current = map;
    return () => {
      clearInterval(lightTimer);
      container.removeEventListener("wheel", onWheel, { capture: true });
      vehicleLabelMarkersRef.current.forEach((m) => m.remove());
      vehicleLabelMarkersRef.current = [];
      const staleLabelRoots = vehicleLabelRootsRef.current;
      vehicleLabelRootsRef.current = [];
      setTimeout(() => staleLabelRoots.forEach((r) => r.unmount()), 0);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      placeMarkersRef.current.forEach((m) => m.remove());
      placeMarkersRef.current.clear();
      const roots = [...popupRootsRef.current, ...placeRootsRef.current];
      popupRootsRef.current = [];
      placeRootsRef.current = [];
      setTimeout(() => roots.forEach((r) => r.unmount()), 0);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 拠点ピン反映（DB から取得したものを貼り直す）。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    placeMarkersRef.current.forEach((m) => m.remove());
    placeMarkersRef.current.clear();
    const staleRoots = placeRootsRef.current;
    placeRootsRef.current = [];
    setTimeout(() => staleRoots.forEach((r) => r.unmount()), 0);

    for (const place of places) {
      const node = document.createElement("div");
      node.style.zIndex = "1"; // 車両ピン(2)・プレート吹き出し(5)より背面
      const root = createRoot(node);
      root.render(<PlaceMarkerBadge icon={place.icon} />);
      placeRootsRef.current.push(root);

      // 名称はユーザー入力のため textContent で入れる（HTML 解釈させない）。
      const popupNode = document.createElement("div");
      popupNode.style.cssText = "padding:4px;font-size:12px;font-weight:700";
      popupNode.textContent = place.name;
      const popup = new mapboxgl.Popup({
        offset: 20,
        maxWidth: "260px",
        closeButton: false,
      }).setDOMContent(popupNode);

      // 編集中の拠点はドラッグで動かせる（置いたら直せないのは実用に耐えない・2026-08-10 要望）
      const isEditing = editingPlaceRef.current?.id === place.id;
      const marker = new mapboxgl.Marker({ element: node, draggable: isEditing })
        .setLngLat([place.lng, place.lat])
        .setPopup(isEditing ? undefined : popup)
        .addTo(map);
      if (isEditing) {
        node.style.cursor = "grab";
        marker.on("dragend", () => {
          const { lng, lat } = marker.getLngLat();
          setEditingPlace((prev) => (prev ? { ...prev, lat, lng } : prev));
        });
      } else if (canWritePlacesRef.current) {
        // クリックで編集パネルを開く（従来は名前が出るだけだった）
        node.addEventListener("click", () => openPlaceEditor(place));
      }
      placeMarkersRef.current.set(place.id, marker);
    }
    applyPlacesVisibilityRef.current();
  }, [places]);

  // ピン追加の位置プレビュー（名称入力中に仮ピンを立てる）。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !draft) return;
    // 検索で立てた位置は建物の中心などにズレることがあるので、つまんで直せるようにする
    const m = new mapboxgl.Marker({ color: "#7c3aed", draggable: true })
      .setLngLat([draft.lng, draft.lat])
      .addTo(map);
    m.on("dragend", () => {
      const { lng, lat } = m.getLngLat();
      setDraft({ lat, lng });
    });
    return () => {
      m.remove();
    };
  }, [draft]);

  /**
   * 車両の状態を導出する。専用の記録が無い「積み込み中」は、
   * **拠点（倉庫・拠点ピン）に停まっている稼働中**を推定で当てる（ユーザー案 2026-08-10）。
   */
  const statusOf = useCallback(
    (v: MapVehicle): VehicleStatus => {
      const p = v.position!;
      if (p.sessionStatus !== "open") return "稼働外";
      const atPlace = places.some(
        (pl) =>
          (pl.icon === "warehouse" || pl.icon === "pin") &&
          distanceM(p.lat, p.lng, pl.lat, pl.lng) <= AT_PLACE_RADIUS_M,
      );
      return atPlace ? "積み込み中" : "稼働中";
    },
    [places],
  );

  /** 位置を1件記録して一覧を更新する。ドラッグ・クリック配置の共通処理。 */
  const savePosition = useCallback(
    async (vehicle: MapVehicle, lat: number, lng: number) => {
      setPlacingMessage(`${plateText(vehicle)} の位置を保存しています…`);
      // 楽観更新: 置いた位置をキャッシュへ即反映する（従来は再取得完了までピンが
      // 一瞬元の位置へ戻っていた）。失敗時は revalidate で実際の状態に戻す。
      const optimistic = () =>
        mutate(
          (prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              vehicles: prev.vehicles.map((v) =>
                v.id === vehicle.id
                  ? {
                      ...v,
                      position: {
                        ...(v.position ?? {}),
                        lat,
                        lng,
                        at: new Date().toISOString(),
                        source: "manual",
                        kind: "manual",
                        sessionStatus: v.position?.sessionStatus ?? "closed",
                        driverName: v.position?.driverName ?? "",
                        placedBy: v.position?.placedBy ?? "",
                        note: v.position?.note ?? null,
                      },
                    }
                  : v,
              ),
            };
          },
          { revalidate: false },
        );
      void optimistic();
      try {
        await apiFetch("/api/admin/map/positions", {
          method: "POST",
          body: JSON.stringify({ vehicleId: vehicle.id, lat, lng }),
        });
        setPlacingMessage(`${plateText(vehicle)} の位置を記録しました`);
        setTimeout(() => setPlacingMessage(null), 2500);
        return true;
      } catch (e) {
        console.error(e);
        setPlacingMessage("位置を保存できませんでした");
        setTimeout(() => setPlacingMessage(null), 4000);
        void mutate(); // 失敗時はサーバー状態へ戻す
        return false;
      }
    },
    [mutate],
  );

  // 車両を選んでから地図をクリックすると、そこへ置く（位置がまだ無い車の導線）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pendingPlaceVehicle) return;
    map.getCanvas().style.cursor = "crosshair";
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const target = pendingPlaceVehicle;
      setPendingPlaceVehicle(null);
      void savePosition(target, e.lngLat.lat, e.lngLat.lng);
    };
    map.once("click", onClick);
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [pendingPlaceVehicle, savePosition]);

  // マーカー反映（データ更新のたびに貼り直す。台数は数十のため十分軽い）。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || located.length === 0) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const staleRoots = popupRootsRef.current;
    popupRootsRef.current = [];
    // 開いている吹き出しの React root を同期で unmount すると警告になるため遅延させる。
    setTimeout(() => staleRoots.forEach((r) => r.unmount()), 0);

    const bounds = new mapboxgl.LngLatBounds();
    for (const v of located) {
      const p = v.position!;
      const node = document.createElement("div");
      const root = createRoot(node);
      root.render(<VehiclePopup vehicle={v} />);
      popupRootsRef.current.push(root);

      const popup = new mapboxgl.Popup({
        offset: 28,
        maxWidth: "240px",
        closeButton: false,
      }).setDOMContent(node);
      const editable = canDispatch && placing && !historyDate;

      // 修正中だけ「つまみ」を出す。通常時はピンを出さない
      //  — 3Dモデル＋ナンバー吹き出し＋ピンの3つが重なって読めなかったため（2026-08-10 指摘）。
      //    通常時のクリック対象はナンバー吹き出し側が持つ（下の「車両ラベル反映」effect）。
      if (!editable) {
        popup.remove();
        popupRootsRef.current = popupRootsRef.current.filter((r) => r !== root);
        setTimeout(() => root.unmount(), 0);
        bounds.extend([p.lng, p.lat]);
        continue;
      }

      const handle = document.createElement("div");
      handle.className = "map-drag-handle";
      handle.title = "つまんで動かす";
      handle.textContent = plateShort(v);
      const marker = new mapboxgl.Marker({ element: handle, draggable: true })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
      marker.getElement().style.zIndex = "6"; // 修正中は最前面に
      marker.getElement().style.cursor = "grab";
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        void savePosition(v, lat, lng).then((ok: boolean) => {
          if (!ok) marker.setLngLat([p.lng, p.lat]); // 失敗したら元の位置へ戻す
        });
      });
      markersRef.current.push(marker);
      bounds.extend([p.lng, p.lat]);
    }

    if (!fittedRef.current) {
      fittedRef.current = true;
      map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
    }
  }, [located, canDispatch, placing, historyDate, savePosition]);

  // 配置モード中は地図のドラッグ移動を止める。
  // （ピンを掴んだつもりで地図が動いてしまう、という迷いをなくす・2026-08-06 実機フィードバック）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (placing && canDispatch && !historyDate) map.dragPan.disable();
    else map.dragPan.enable();
  }, [placing, canDispatch, historyDate]);

  // エリア編集: mapbox-gl-draw を編集中だけ地図に載せる。
  // 常時載せるとクリックが Draw に吸われて他の操作（拠点の選択・車両の配置）が効かなくなる。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!editingAreaCourse && !slotPlace) {
      if (drawRef.current) {
        map.removeControl(drawRef.current as unknown as mapboxgl.IControl);
        drawRef.current = null;
      }
      return;
    }
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: editingAreaCourse?.delivery_area ? "simple_select" : "draw_polygon",
    });
    map.addControl(draw as unknown as mapboxgl.IControl, "top-right");
    drawRef.current = draw;
    // 既存のエリアがあれば編集対象として読み込む（引き直しではなく修正ができるように）
    if (editingAreaCourse?.delivery_area) {
      draw.add({
        type: "Feature",
        properties: {},
        geometry: editingAreaCourse.delivery_area,
      } as never);
    }
    return () => {
      if (drawRef.current) {
        map.removeControl(drawRef.current as unknown as mapboxgl.IControl);
        drawRef.current = null;
      }
    };
  }, [editingAreaCourse, slotPlace]);

  /** 区画を保存する。描いた形は最小面積の長方形に整えてから送る。 */
  const saveParkingSlot = async () => {
    const draw = drawRef.current;
    if (!draw || !slotPlace || slotSaving) return;
    const label = slotLabel.trim();
    if (!label) {
      setSlotError("区画名（例: 12番）を入力してください");
      return;
    }
    const feature = draw.getAll().features.find((f) => f.geometry?.type === "Polygon");
    if (!feature) {
      setSlotError("区画が描かれていません。多角形ツールで囲ってください");
      return;
    }
    const ring = (feature.geometry as unknown as { coordinates: [number, number][][] }).coordinates[0];
    const rect = snapToRectangle(ring);
    setSlotSaving(true);
    setSlotError("");
    try {
      await apiFetch("/api/admin/map/parking-slots", {
        method: "POST",
        body: JSON.stringify({
          placeId: slotPlace.id,
          label,
          vehicleId: slotVehicleId || null,
          geometry: { type: "Polygon", coordinates: [rect] },
        }),
      });
      // 続けて次の区画を描けるようにする（駐車場は区画が並んでいるので連続入力が普通）。
      // deleteAll だけだと simple_select のままで多角形ツールが押せない状態になる（2026-08-10 指摘）
      draw.deleteAll();
      draw.changeMode("draw_polygon");
      setSlotLabel(nextSlotLabel(label));
      setSlotVehicleId("");
      void refreshSlots();
    } catch (e) {
      console.error(e);
      setSlotError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSlotSaving(false);
    }
  };

  /** 描いた面を保存する。複数描かれていたら MultiPolygon にまとめる。 */
  const saveCourseArea = async () => {
    const draw = drawRef.current;
    const course = editingAreaCourse;
    if (!draw || !course || areaSaving) return;
    const features = draw.getAll().features.filter((f) => f.geometry?.type === "Polygon");
    if (features.length === 0) {
      setAreaError("エリアが描かれていません。多角形ツールで囲ってください");
      return;
    }
    const area =
      features.length === 1
        ? (features[0].geometry as { type: "Polygon"; coordinates: number[][][] })
        : {
            type: "MultiPolygon" as const,
            coordinates: features.map((f) => (f.geometry as { coordinates: number[][][] }).coordinates),
          };
    setAreaSaving(true);
    setAreaError("");
    try {
      await apiFetch(`/api/admin/map/course-areas/${course.id}`, {
        method: "PUT",
        body: JSON.stringify({ area }),
      });
      setEditingAreaCourse(null);
      void refreshCourseAreas();
    } catch (e) {
      console.error(e);
      setAreaError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setAreaSaving(false);
    }
  };

  /** エリアを消す（コースは消さない）。 */
  const clearCourseArea = async (course: CourseArea) => {
    setAreaSaving(true);
    try {
      await apiFetch(`/api/admin/map/course-areas/${course.id}`, { method: "DELETE" });
      setEditingAreaCourse(null);
      void refreshCourseAreas();
    } catch (e) {
      console.error(e);
      setAreaError(e instanceof Error ? e.message : "削除できませんでした");
    } finally {
      setAreaSaving(false);
    }
  };

  /** その座標が駐車区画の中なら、その区画の向きを返す（区画外は 0）。 */
  const slotBearingAt = useCallback(
    (lng: number, lat: number): number => {
      for (const sl of slots) {
        const ring = sl.geometry?.coordinates?.[0];
        if (ring && pointInRing(lng, lat, ring)) return sl.bearing ?? 0;
      }
      return 0;
    },
    [slots],
  );

  // 面のデータ反映。レイヤーは地図の初期化側で作ってあるので、ここは setData だけ。
  useEffect(() => {
    const apply = () => {
      const map = mapRef.current;
      if (!map) return;
      const slotSrc = map.getSource("parking-slots") as mapboxgl.GeoJSONSource | undefined;
      slotSrc?.setData({
        type: "FeatureCollection",
        features: slots.map((sl) => ({
          type: "Feature",
          properties: { label: sl.label },
          geometry: sl.geometry,
        })),
      } as never);

      const courseSrc = map.getSource("course-areas") as mapboxgl.GeoJSONSource | undefined;
      courseSrc?.setData({
        type: "FeatureCollection",
        features: courseAreas
          .filter((c) => c.delivery_area && c.id !== editingAreaCourse?.id) // 編集中は Draw 側が描く
          .map((c) => ({
            type: "Feature",
            properties: { color: c.color || "#7c3aed", name: c.name },
            geometry: c.delivery_area!,
          })),
      } as never);

      // 夜（dusk/night）のときだけ、稼働中の車両にライトを灯す
      const hour = Number(
        new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false })
          .formatToParts(new Date())
          .find((p) => p.type === "hour")?.value ?? "12",
      );
      const isNight = hour >= 17 || hour < 5;
      const lightSrc = map.getSource("vehicle-lights") as mapboxgl.GeoJSONSource | undefined;
      lightSrc?.setData({
        type: "FeatureCollection",
        features:
          isNight && !historyDate
            ? located
                .filter((v) => v.position!.sessionStatus === "open")
                .map((v) => ({
                  type: "Feature",
                  properties: {},
                  geometry: { type: "Point", coordinates: [v.position!.lng, v.position!.lat] },
                }))
            : [],
      } as never);

      const placeSrc = map.getSource("place-areas") as mapboxgl.GeoJSONSource | undefined;
      placeSrc?.setData({
        type: "FeatureCollection",
        features: places
          .filter((pl) => pl.shape === "circle" && (pl.radius_m ?? 0) > 0)
          .map((pl) => circlePolygon(pl.lat, pl.lng, pl.radius_m!)),
      } as never);
    };
    applyAreaDataRef.current = apply;
    apply();
  }, [slots, courseAreas, editingAreaCourse, places, located, historyDate]);

  // 検索結果を地図にピンで出す。一覧だけだと「どこにあるか」が分からない（2026-08-10 指摘）。
  // 拠点ピンとは見た目を変える（白丸＋種別色のアイコン＋番号）。
  const hitMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const hitRootsRef = useRef<Root[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    hitMarkersRef.current.forEach((m) => m.remove());
    hitMarkersRef.current = [];
    const stale = hitRootsRef.current;
    hitRootsRef.current = [];
    setTimeout(() => stale.forEach((r) => r.unmount()), 0);

    searchResults.forEach((hit, i) => {
      const node = document.createElement("div");
      node.style.zIndex = "7"; // 車両ラベルより前（選ぶ対象なので）
      node.style.cursor = "pointer";
      node.title = hit.name;
      const root = createRoot(node);
      root.render(<SearchHitMarker index={i + 1} icon={searchIconHint} active={hoveredHitId === hit.id} />);
      hitRootsRef.current.push(root);
      const marker = new mapboxgl.Marker({ element: node, anchor: "bottom" })
        .setLngLat([hit.lng, hit.lat])
        .addTo(map);
      node.addEventListener("click", () => pickSearchResultRef.current(hit));
      node.addEventListener("mouseenter", () => setHoveredHitId(hit.id));
      node.addEventListener("mouseleave", () => setHoveredHitId(null));
      hitMarkersRef.current.push(marker);
    });
  }, [searchResults, searchIconHint, hoveredHitId]);

  // 検索後に地図を動かしたら「このエリアを再検索」を出す（Google マップと同じ考え方）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !lastSearch) return;
    const onMove = () => setMovedSinceSearch(true);
    map.on("moveend", onMove);
    return () => {
      map.off("moveend", onMove);
    };
  }, [lastSearch]);

  // 車両ラベル反映: **実データ**の位置にプレート吹き出しと3Dモデルを置く。
  // デモ車両（ハードコード10台）は廃止した（2026-08-07）。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 3Dモデルのソースを実データで差し替える
    const applyModelData = () => {
      const src = mapRef.current?.getSource("truck-src") as mapboxgl.GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: displayedVehicles.map((v) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [v.position!.lng, v.position!.lat] },
          properties: {
            // 区画の中にいるならその区画の軸に合わせる。区画に対して斜めに刺さっていると
            // 一気に嘘くさくなるため（2026-08-10）。区画外は正面固定（GPS の heading が入ったらそれを使う）
            rotation: [0, 0, slotBearingAt(v.position!.lng, v.position!.lat)],
            // 車体色（未設定は白＝モデル本来の色を保つ）
            color: v.body_color || "#ffffff",
            // 車種（vehicles.model_key）。未設定・未知は既定モデル
            model:
              v.model_key && v.model_key in VEHICLE_MODEL_URLS ? v.model_key : DEFAULT_VEHICLE_MODEL_KEY,
          },
        })),
      });
    };
    applyVehicleModelDataRef.current = applyModelData;
    applyModelData();

    // 吹き出しを貼り直す
    vehicleLabelMarkersRef.current.forEach((m) => m.remove());
    vehicleLabelMarkersRef.current = [];
    const staleRoots = vehicleLabelRootsRef.current;
    vehicleLabelRootsRef.current = [];
    setTimeout(() => staleRoots.forEach((r) => r.unmount()), 0);

    // 修正中は「つまみ」だけを出す（ラベルと重ねない）
    if (canDispatch && placing && !historyDate) {
      declutterPlatesRef.current();
      return;
    }

    for (const v of displayedVehicles) {
      const p = v.position!;
      const node = document.createElement("div");
      node.className = "vehicle-label"; // globals.css で吹き出し⇔ドットを切替
      node.style.zIndex = "5"; // 拠点ピンより前面
      node.style.cursor = "pointer";
      node.addEventListener("click", () => setSelectedVehicleId(v.id));
      const root = createRoot(node);
      root.render(
        <VehicleLabel
          vehicle={v}
          status={statusOf(v)}
          selected={mapMode === "movements" && selectedMovement?.vehicleId === v.id}
        />,
      );
      vehicleLabelRootsRef.current.push(root);

      // クリック対象はこの吹き出し（通常時はピンを出さないため）
      const popupNode = document.createElement("div");
      const popupRoot = createRoot(popupNode);
      popupRoot.render(<VehiclePopup vehicle={v} />);
      vehicleLabelRootsRef.current.push(popupRoot);
      const popup = new mapboxgl.Popup({ offset: 16, maxWidth: "240px", closeButton: false }).setDOMContent(
        popupNode,
      );

      vehicleLabelMarkersRef.current.push(
        new mapboxgl.Marker({ element: node, anchor: "bottom", offset: [0, -30] })
          .setLngLat([p.lng, p.lat])
          .setPopup(popup)
          .addTo(map),
      );
    }
    declutterPlatesRef.current();
  }, [displayedVehicles, statusOf, canDispatch, placing, historyDate, slotBearingAt, mapMode, selectedMovement]);

  // 2D/3D トグル: ピッチだけ変える（方位はユーザー操作を尊重してそのまま）。
  const setView = (mode: "2d" | "3d") => {
    mapRef.current?.easeTo({ pitch: mode === "3d" ? 62 : 0, duration: 900 });
  };

  // 拠点を選択 → その場所へフライト＆吹き出しを開く（ピッチ・方位は現状維持）。
  const flyToPlace = (place: MapPlace) => {
    setSettingsOpen(false);
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [place.lng, place.lat], zoom: 16.5, duration: 2200 });
    placeMarkersRef.current.forEach((marker, id) => {
      const open = marker.getPopup()?.isOpen() ?? false;
      if (id === place.id ? !open : open) marker.togglePopup();
    });
  };

  const saveDraft = async () => {
    if (!draft || savingDraft) return;
    const name = draftName.trim();
    if (!name) {
      setDraftError("名称を入力してください");
      return;
    }
    setSavingDraft(true);
    try {
      await apiFetch("/api/admin/map/places", {
        method: "POST",
        body: JSON.stringify({ name, icon: draftIcon, lat: draft.lat, lng: draft.lng }),
      });
      setDraft(null);
      setDraftName("");
      setDraftIcon("pin");
      setDraftError("");
      setShowPlaces(true); // 追加した直後に見えないと不安なので表示をオンにする
      void refreshPlaces();
    } catch {
      setDraftError("保存に失敗しました");
    } finally {
      setSavingDraft(false);
    }
  };

  const deletePlace = async (place: MapPlace) => {
    try {
      await apiFetch(`/api/admin/map/places/${place.id}`, { method: "DELETE" });
      void refreshPlaces();
    } catch {
      // 失敗時は一覧が変わらないだけなので握りつぶす（再試行可能）
    }
  };

  const selectMapMode = (mode: MapMode) => {
    setMapMode(mode);
    setPlacing(false);
    if (mode === "history") {
      setHistoryDate((date) => date ?? todayJST());
    } else {
      setHistoryDate(null);
    }
    if (mode === "movements") setShowPlaces(true);
  };

  const fitMovements = () => {
    const map = mapRef.current;
    if (!map || activeMovements.length === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    for (const movement of activeMovements) {
      const vehicle = (data?.vehicles ?? []).find((item) => item.id === movement.vehicleId);
      if (vehicle?.position) bounds.extend([vehicle.position.lng, vehicle.position.lat]);
      else if (movement.fromPlace) bounds.extend([movement.fromPlace.lng, movement.fromPlace.lat]);
      if (movement.toPlace) bounds.extend([movement.toPlace.lng, movement.toPlace.lat]);
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 90, maxZoom: 13.5, duration: 700 });
  };

  const openMovementForm = (movement?: VehicleMovement) => {
    const vehicle = movement
      ? (data?.vehicles ?? []).find((item) => item.id === movement.vehicleId) ?? null
      : selectedVehicle ?? located[0] ?? null;
    const nearestPlace = vehicle?.position
      ? [...(operationsData?.places ?? [])].sort(
          (a, b) =>
            distanceM(vehicle.position!.lat, vehicle.position!.lng, a.lat, a.lng) -
            distanceM(vehicle.position!.lat, vehicle.position!.lng, b.lat, b.lng),
        )[0]
      : operationsData?.places[0];
    const due = movement
      ? dateTimeInJst(movement.dueAt)
      : { date: todayJST(), time: "18:00" };
    setMovementError("");
    setMovementForm({
      id: movement?.id ?? null,
      expectedVersion: movement?.version ?? null,
      vehicleId: movement?.vehicleId ?? vehicle?.id ?? "",
      fromPlaceId: movement?.fromPlaceId ?? nearestPlace?.id ?? "",
      toPlaceId:
        movement?.toPlaceId ??
        (operationsData?.places ?? []).find((place) => place.id !== nearestPlace?.id)?.id ??
        "",
      assigneeDriverId: movement?.assigneeDriverId ?? "",
      dueDate: due.date,
      dueTime: due.time,
      note: movement?.note ?? "",
    });
  };

  const saveMovement = async () => {
    if (!movementForm || movementSaving) return;
    if (
      !movementForm.vehicleId ||
      !movementForm.fromPlaceId ||
      !movementForm.toPlaceId ||
      !movementForm.dueDate ||
      !movementForm.dueTime
    ) {
      setMovementError("車両・出発地・届け先・期限を入力してください");
      return;
    }
    if (movementForm.fromPlaceId === movementForm.toPlaceId) {
      setMovementError("車両移動では、出発地と異なる届け先を選んでください");
      return;
    }
    setMovementSaving(true);
    setMovementError("");
    try {
      const draft = {
        vehicleId: movementForm.vehicleId,
        fromPlaceId: movementForm.fromPlaceId,
        toPlaceId: movementForm.toPlaceId,
        assigneeDriverId: movementForm.assigneeDriverId || null,
        dueAt: new Date(`${movementForm.dueDate}T${movementForm.dueTime}:00+09:00`).toISOString(),
        note: movementForm.note,
      };
      await apiFetch("/api/admin/map/movements", {
        method: movementForm.id ? "PATCH" : "POST",
        body: JSON.stringify(
          movementForm.id
            ? {
                ...draft,
                id: movementForm.id,
                expectedVersion: movementForm.expectedVersion,
                action: "save",
              }
            : draft,
        ),
      });
      setMovementForm(null);
      await mutateOperations();
    } catch (error) {
      setMovementError(error instanceof Error ? error.message : "保存できませんでした");
    } finally {
      setMovementSaving(false);
    }
  };

  const finishMovement = async () => {
    if (!selectedMovement || !completionPlaceId || movementSaving) return;
    setMovementSaving(true);
    setMovementError("");
    try {
      await apiFetch("/api/admin/map/movements", {
        method: "PATCH",
        body: JSON.stringify({
          id: selectedMovement.id,
          expectedVersion: selectedMovement.version,
          action: "complete",
          actualPlaceId: completionPlaceId,
          arrivedAt: new Date().toISOString(),
        }),
      });
      setCompletingMovement(false);
      setCompletionPlaceId("");
      await Promise.all([mutateOperations(), mutate()]);
    } catch (error) {
      setMovementError(error instanceof Error ? error.message : "完了を記録できませんでした");
    } finally {
      setMovementSaving(false);
    }
  };

  useEffect(() => {
    if (mapMode !== "movements" || !selectedMovement) return;
    if (selectedVehicleId !== selectedMovement.vehicleId) setSelectedVehicleId(selectedMovement.vehicleId);
  }, [mapMode, selectedMovement, selectedVehicleId]);

  const selectedArrowFrom: [number, number] | null = selectedVehicle?.position
    ? [selectedVehicle.position.lng, selectedVehicle.position.lat]
    : selectedMovement?.fromPlace
      ? [selectedMovement.fromPlace.lng, selectedMovement.fromPlace.lat]
      : null;
  const selectedArrowTo: [number, number] | null = selectedMovement?.toPlace
    ? [selectedMovement.toPlace.lng, selectedMovement.toPlace.lat]
    : null;

  return (
    <AdminLayout>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">地図</h1>
          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
            ベータ
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* 事実・予定・過去を混ぜず、見る目的を先に選ぶ。 */}
            <div className="flex rounded-lg bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => selectMapMode("current")}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  mapMode === "current" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                いま
              </button>
              {canViewShifts && (
                <button
                  type="button"
                  onClick={() => selectMapMode("movements")}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    mapMode === "movements" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <FontAwesomeIcon icon={faRoute} className="mr-1.5 h-3 w-3" />
                  車両移動
                </button>
              )}
              <button
                type="button"
                onClick={() => selectMapMode("history")}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  mapMode === "history" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                履歴
              </button>
            </div>

            {/* 位置を置く（配置モード）。ドラッグと地図移動の取り合いをなくすため明示的なモードにする */}
            {canDispatch && mapMode === "current" && (
              <button
                type="button"
                onClick={() => setPlacing((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  placing
                    ? "bg-sky-600 text-white hover:bg-sky-700"
                    : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <FontAwesomeIcon icon={faLocationDot} className="h-3 w-3" />
                {placing ? "位置の修正を終える" : "車の位置を直す"}
              </button>
            )}

            {canDispatch && canViewShifts && mapMode !== "history" && (
              <button
                type="button"
                onClick={() => openMovementForm()}
                disabled={(operationsData?.places.length ?? 0) < 2 || located.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                移動を登録
              </button>
            )}

            <button
              type="button"
              onClick={() => void mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <FontAwesomeIcon icon={faRotateRight} className="h-3 w-3" />
              更新
            </button>
          </div>
        </div>

        {/* 状況に応じた案内。何ができる状態なのかを常に1行で示す */}
        {mapMode === "movements" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <FontAwesomeIcon icon={faRoute} className="h-3 w-3 shrink-0" />
            未完了で、出発地と届け先が異なる車両だけを表示しています。
            <span className="font-semibold">{activeMovements.length} 台</span>
            {activeMovements.length > 0 && (
              <button type="button" onClick={fitMovements} className="ml-auto font-semibold underline underline-offset-2">
                全体を見る
              </button>
            )}
          </div>
        ) : placingMessage ? (
          <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            <FontAwesomeIcon icon={faLocationDot} className="h-3 w-3 shrink-0" />
            {placingMessage}
          </div>
        ) : placing ? (
          <div className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-100 px-3 py-2 text-xs font-medium text-sky-900">
            <FontAwesomeIcon icon={faLocationDot} className="h-3 w-3 shrink-0" />
            位置の修正中: 青く光っているピンをつまんで、実際にいる場所へ動かしてください。
            地図の移動は一時的に止めています（ズームはスクロールでできます）。
            終わったら「位置の修正を終える」を押してください
          </div>
        ) : historyDate ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <FontAwesomeIcon icon={faLocationDot} className="h-3 w-3 shrink-0" />
            履歴を表示しています。その時刻時点で記録されていた最後の位置を出しています（点と点は繋ぎません）
          </div>
        ) : canDispatch ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <FontAwesomeIcon icon={faLocationDot} className="h-3 w-3 shrink-0" />
            GPS がまだ無い車の居場所は、手で教えられます。「車の位置を直す」を押してください
            （打刻GPSは上書きしません）
          </div>
        ) : null}

        {/* まだ位置が無い車両は掴むピンが無い。一覧から選んで地図をクリックして置く（鶏卵の解消） */}
        {canDispatch && mapMode === "current" && unlocated.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
              <FontAwesomeIcon icon={faLocationDot} className="h-3 w-3" />
              まだ位置がない車両 {unlocated.length} 台
              {pendingPlaceVehicle ? (
                <span className="font-bold text-sky-700">
                  — 地図をクリックすると {plateText(pendingPlaceVehicle)} をそこに置きます
                </span>
              ) : (
                <span className="font-normal text-slate-400">— 車両を選んでから地図をクリック</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {unlocated.map((v) => {
                const selected = pendingPlaceVehicle?.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setPendingPlaceVehicle(selected ? null : v)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      selected
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {plateText(v)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 位置が1件も無いときは、その事実をはっきり出す（マーカーが無いのか、掴めないのか区別できるように） */}
        {!isLoading && mapMode !== "movements" && located.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <FontAwesomeIcon icon={faLocationDot} className="h-3 w-3 shrink-0" />
            位置が記録された車両がまだありません（打刻GPSも手動配置も0件）。
            {historyDate
              ? "別の日時を選んでみてください。"
              : canDispatch
                ? "上の一覧から車両を選び、地図をクリックすると置けます。"
                : "GPS付きの出退勤打刻が入ると表示されます。"}
          </div>
        )}

        {/* 履歴の日時指定。疎な記録を連続観測に見せないためスライダーは使わない。 */}
        {mapMode === "history" && historyDate && (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600">表示する日時</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid w-full grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:flex sm:w-auto">
                <DatePicker
                  ariaLabel="履歴の日付"
                  value={reportDateStrToDate(historyDate)}
                  displayFormat="yyyy/M/d（E）"
                  toDate={reportDateStrToDate(todayJST())}
                  onChange={(value) => value && setHistoryDate(dateToReportDateStr(value))}
                  className="min-h-11 w-full sm:w-[164px]"
                />
                <div aria-label="履歴の時刻" className="sm:w-28">
                  <TimePicker
                    value={historyTime}
                    onChange={(value) => value && setHistoryTime(value)}
                    minuteStep={5}
                    clearable={false}
                    buttonClassName="min-h-11"
                  />
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
                <button
                  type="button"
                  disabled={!historyNeighbors?.previousAt}
                  onClick={() => historyNeighbors?.previousAt && selectHistoryAt(historyNeighbors.previousAt)}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  <FontAwesomeIcon icon={faChevronLeft} className="mr-1.5 size-3" />
                  前の記録
                </button>
                <button
                  type="button"
                  disabled={!historyNeighbors?.nextAt}
                  onClick={() => historyNeighbors?.nextAt && selectHistoryAt(historyNeighbors.nextAt)}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  次の記録
                  <FontAwesomeIcon icon={faChevronRight} className="ml-1.5 size-3" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              各車両は、指定日時以前の最後の記録位置です。記録と記録の間は推測しません。
            </p>
          </div>
        )}

        {mapMode !== "movements" && <p className="text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            稼働中
          </span>
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
            退勤済み
          </span>
          {unlocatedCount > 0 && (
            <span className="ml-2 text-slate-400">位置情報のない車両 {unlocatedCount} 台は非表示</span>
          )}
        </p>}

        {mapMode === "movements" && operationsError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            車両移動を読み込めませんでした。DB更新の適用後に、もう一度お試しください。
          </div>
        )}

        {mapMode === "movements" && !operationsLoading && !operationsError && activeMovements.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
            移動が必要な車両はありません。新しく手配する場合は「移動を登録」を押してください。
          </div>
        )}

        {!MAPBOX_TOKEN ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Mapbox のアクセストークンが未設定です。環境変数{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[12px]">
              NEXT_PUBLIC_MAPBOX_TOKEN
            </code>{" "}
            を設定してください（ローカルは apps/web/.env.local、本番は Vercel の環境変数）。
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl border border-slate-200 shadow-sm">
              <div ref={containerRef} className="h-[70vh] min-h-[420px] w-full" />
              <AerialMovementArrow
                map={mapRef.current}
                from={selectedArrowFrom}
                to={selectedArrowTo}
                visible={mapMode === "movements" && selectedMovement != null}
              />

            {/* 視点の操作パネル＋設定＋共有ビュー */}
            <div className="absolute left-3 right-3 top-3 flex flex-col items-start gap-2 md:right-auto">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-lg bg-white/95 p-1 shadow">
                  {(["2d", "3d"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setView(mode)}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase transition-colors ${
                        (mode === "3d") === is3D
                          ? "bg-slate-900 text-white"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                {mapMode !== "movements" && <>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white/95 text-slate-500 shadow transition-colors hover:text-slate-800"
                  aria-label="地図の設定"
                >
                  <FontAwesomeIcon icon={faGear} className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setAreaPanelOpen((v) => !v)}
                  className={`flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold shadow transition-colors ${
                    areaPanelOpen || editingAreaCourse
                      ? "bg-slate-900 text-white"
                      : "bg-white/95 text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <FontAwesomeIcon icon={faDrawPolygon} className="h-3.5 w-3.5" />
                  配達エリア
                </button>
                </>}
                <button
                  type="button"
                  onClick={() => setShareOn((v) => !v)}
                  className={`flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold shadow transition-colors ${
                    shareOn ? "bg-slate-900 text-white" : "bg-white/95 text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <FontAwesomeIcon icon={faUsers} className="h-3.5 w-3.5" />
                  {share.status === "connecting" ? "接続中..." : "共有"}
                </button>
              </div>

              {/* 地点検索。住所や施設名で拠点を立てられるようにする（クリックだけだと場所を知らないと置けない） */}
              {canWritePlaces && mapMode !== "movements" && (
              <div className="relative w-[min(320px,calc(100vw-3rem))]">
                <div className="flex items-center gap-2 rounded-lg bg-white/95 px-2.5 py-1.5 shadow-md backdrop-blur">
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="住所・施設名で探す（例: 京都市伏見区…）"
                    className="w-full bg-transparent text-xs outline-none placeholder:text-slate-400"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
                    </button>
                    )}
                </div>
                  {/* よく調べる種別のショートカット。名前を知らない場所は種別からしか探せない */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {SEARCH_SHORTCUTS.map((sc) => (
                    <button
                      key={sc.label}
                      type="button"
                      onClick={() => void runShortcut(sc)}
                      className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-900"
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>

                {(searching || searchResults.length > 0) && (
                  <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[320px] overflow-y-auto rounded-lg bg-white shadow-lg">
                    {!searching && searchResults.length > 0 && (
                      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                        <span className="text-[10px] font-semibold text-slate-400">
                          いま表示中の範囲から {searchResults.length} 件
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchResults([]);
                            setLastSearch(null);
                          }}
                          className="text-[10px] text-slate-400 hover:text-slate-600"
                        >
                          閉じる
                        </button>
                      </div>
                      )}
                    {searching && searchResults.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] text-slate-400">検索しています…</div>
                    ) : (
                      searchResults.map((hit) => (
                        <button
                          key={hit.id}
                          type="button"
                          onClick={() => pickSearchResult(hit)}
                          className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                        >
                          <div className="text-xs font-semibold text-slate-800">{hit.name}</div>
                          {hit.address && (
                            <div className="truncate text-[11px] text-slate-500">{hit.address}</div>
                            )}
                        </button>
                      ))
                      )}
                  </div>
                  )}
              </div>
              )}

              {/* 共有ビューの参加者。タップでその人の視点に追従（もう一度で解除） */}
              {shareOn && share.status === "connected" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {share.participants.map((p) => {
                    const isSelf = p.id === share.selfId;
                    const following = share.followingId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={isSelf}
                        onClick={() => share.setFollowingId(following ? null : p.id)}
                        title={isSelf ? undefined : following ? "追従を解除" : "この人の視点に追従"}
                        className={`flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-[11px] font-bold shadow transition-colors ${
                          following ? "bg-slate-900 text-white" : "bg-white/95 text-slate-700 hover:bg-white"
                        } ${isSelf ? "opacity-80" : ""}`}
                      >
                        <span
                          className="h-3 w-3 rounded-full border border-white/70"
                          style={{ backgroundColor: p.color }}
                        />
                        {isSelf ? `${p.name}（自分）` : p.name}
                        {following && <span className="text-[10px] font-normal">追従中</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {shareOn && share.status === "error" && (
                <p className="rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 shadow">
                  {share.errorMsg ?? "共有ビューに接続できませんでした"}
                </p>
              )}
            </div>

            {/* ピン追加モードの案内バナー */}
            {/* 地図を動かしたら再検索を促す（Google マップの「このエリアを検索」と同じ） */}
            {lastSearch && movedSinceSearch && (
              <button
                type="button"
                onClick={() => void runSearch(lastSearch)}
                className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-xs font-bold text-white shadow-lg hover:bg-slate-800"
              >
                <FontAwesomeIcon icon={faRotateRight} className="mr-1.5 h-3 w-3" />
                このエリアを再検索
              </button>
            )}

            {adding && (
              <div className="absolute inset-x-0 top-3 mx-auto flex w-fit items-center gap-3 rounded-full bg-slate-900/95 px-4 py-2 text-xs font-semibold text-white shadow-lg">
                追加する位置を地図でクリックしてください
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] hover:bg-white/25"
                >
                  中止（Esc）
                </button>
              </div>
            )}

            {mapMode === "movements" && (
              <div className="absolute bottom-3 right-3 z-10 hidden w-[320px] lg:block">
                <MovementDetailCard
                  movement={selectedMovement}
                  vehicle={selectedVehicle}
                  upcomingUse={selectedUpcomingUse}
                  places={operationsData?.places ?? []}
                  canDispatch={canDispatch}
                  completing={completingMovement}
                  completionPlaceId={completionPlaceId}
                  saving={movementSaving}
                  error={movementError}
                  onEdit={() => selectedMovement && openMovementForm(selectedMovement)}
                  onStartComplete={() => {
                    setMovementError("");
                    setCompletionPlaceId(selectedMovement?.toPlaceId ?? "");
                    setCompletingMovement(true);
                  }}
                  onCompletionPlaceChange={setCompletionPlaceId}
                  onComplete={() => void finishMovement()}
                  onCancelComplete={() => setCompletingMovement(false)}
                  onCancel={() => selectedMovement && setCancelMovement(selectedMovement)}
                />
              </div>
            )}

            {/* 配達エリア: コースを選んで面を描く（エリアはコースの属性・2026-08-10 合意） */}
            {areaPanelOpen && !editingAreaCourse && (
              <div className="absolute bottom-3 left-3 right-3 z-10 max-h-[55%] overflow-y-auto rounded-xl bg-white p-3 shadow-lg md:bottom-auto md:left-auto md:right-3 md:top-3 md:max-h-[70%] md:w-[min(280px,calc(100vw-3rem))]">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">配達エリア</span>
                  <button
                    type="button"
                    onClick={() => setAreaPanelOpen(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">
                  コースごとに担当区域を描けます。地図には色分けして重なります
                </p>
                <ul className="space-y-1">
                  {courseAreas.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAreaError("");
                          setEditingAreaCourse(c);
                          setAreaPanelOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: c.color || "#7c3aed" }}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{c.name}</span>
                        <span className="shrink-0 text-[10px] font-semibold text-slate-400">
                          {c.delivery_area ? "編集" : "描く"}
                        </span>
                      </button>
                    </li>
                  ))}
                  {courseAreas.length === 0 && (
                    <li className="px-2 py-3 text-center text-[11px] text-slate-400">コースがありません</li>
                  )}
                </ul>
              </div>
            )}

            {/* エリア描画中のパネル */}
            {editingAreaCourse && (
              <div className="absolute bottom-3 left-3 right-3 z-10 rounded-xl bg-white p-3 shadow-lg md:bottom-auto md:left-auto md:right-3 md:top-3 md:w-[min(280px,calc(100vw-3rem))]">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: editingAreaCourse.color || "#7c3aed" }}
                  />
                  <span className="truncate text-xs font-bold text-slate-700">
                    {editingAreaCourse.name} のエリア
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  右上の多角形ツールで囲みます。頂点をドラッグして直せます。
                  ダブルクリックで閉じてください
                </p>
                {areaError && <div className="mt-2 text-[11px] text-red-600">{areaError}</div>}
                <div className="mt-3 flex items-center justify-between">
                  {editingAreaCourse.delivery_area ? (
                    <button
                      type="button"
                      onClick={() => void clearCourseArea(editingAreaCourse)}
                      className="text-[11px] font-semibold text-red-600 hover:underline"
                    >
                      エリアを削除
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAreaCourse(null);
                        setAreaError("");
                      }}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveCourseArea()}
                      disabled={areaSaving}
                      className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {areaSaving ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 駐車区画の作成（航空写真に合わせて囲む → 長方形に整えて保存） */}
            {slotPlace && (
              <div className="absolute bottom-3 left-3 right-3 z-10 rounded-xl bg-white p-3 shadow-lg md:bottom-auto md:left-auto md:right-3 md:top-3 md:w-[min(300px,calc(100vw-3rem))]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate text-xs font-bold text-slate-700">
                    {slotPlace.name} の駐車区画
                  </span>
                  <button
                    type="button"
                    onClick={() => setSlotPlace(null)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  右上の多角形ツールで1区画を囲みます。ざっくりで構いません（最小の長方形に
                  整えて保存します）。車の向きは長辺から自動で決まります
                </p>

                <label className="mt-2 block text-[11px] font-semibold text-slate-500">区画名</label>
                <input
                  type="text"
                  value={slotLabel}
                  onChange={(e) => setSlotLabel(e.target.value)}
                  placeholder="例: 12番"
                  maxLength={20}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                />

                <label className="mt-2 block text-[11px] font-semibold text-slate-500">
                  定位置の車両（任意）
                </label>
                <select
                  value={slotVehicleId}
                  onChange={(e) => setSlotVehicleId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
                >
                  <option value="">未設定</option>
                  {(data?.vehicles ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {plateText(v)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-slate-400">
                  設定すると「今日の車がどこにあるか」に答えられます
                </p>

                {slotError && <div className="mt-2 text-[11px] text-red-600">{slotError}</div>}

                {/* 保存済みの区画をその場に出す（「作ったのに消えた」と見えないように） */}
                {slots.filter((sl) => sl.place_id === slotPlace.id).length > 0 && (
                  <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-slate-200">
                    {slots
                      .filter((sl) => sl.place_id === slotPlace.id)
                      .map((sl) => (
                        <div
                          key={sl.id}
                          className="flex items-center justify-between border-b border-slate-100 px-2 py-1 last:border-b-0"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              mapRef.current?.flyTo({ center: [sl.lng, sl.lat], zoom: 20, duration: 500 })
                            }
                            className="text-[11px] font-semibold text-slate-700 hover:underline"
                          >
                            {sl.label}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/map/parking-slots/${sl.id}`, { method: "DELETE" });
                              void refreshSlots();
                            }}
                            className="text-slate-300 hover:text-red-600"
                            aria-label={`${sl.label}を削除`}
                          >
                            <FontAwesomeIcon icon={faTrashCan} className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    この拠点に {slots.filter((sl) => sl.place_id === slotPlace.id).length} 区画
                  </span>
                  <button
                    type="button"
                    onClick={() => void saveParkingSlot()}
                    disabled={slotSaving}
                    className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {slotSaving ? "保存中..." : "この区画を保存"}
                  </button>
                </div>
              </div>
            )}

            {/* 拠点の編集パネル（登録済みのピンをクリックで開く） */}
            {editingPlace && (
              <div className="absolute inset-x-3 bottom-3 mx-auto w-full max-w-sm rounded-xl bg-white p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">拠点を編集</span>
                  <span className="text-[10px] text-slate-400">ピンをドラッグして移動できます</span>
                </div>
                <input
                  type="text"
                  value={editingPlace.name}
                  onChange={(e) => setEditingPlace({ ...editingPlace, name: e.target.value })}
                  maxLength={50}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {(Object.keys(PLACE_ICONS) as PlaceIcon[]).map((key) => {
                    const active = editingPlace.icon === key;
                    const meta = PLACE_ICONS[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setEditingPlace({ ...editingPlace, icon: key })}
                        className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-300 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <FontAwesomeIcon icon={meta.icon} className="h-3 w-3" />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>

                {/* 範囲（円）。0 は点のまま。敷地やエリアを表すのに使う */}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>範囲（半径）</span>
                    <span className="font-bold text-slate-700">
                      {editingPlace.radius_m ? `${editingPlace.radius_m} m` : "点のまま"}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    step={10}
                    value={editingPlace.radius_m ?? 0}
                    onChange={(e) =>
                      setEditingPlace({ ...editingPlace, radius_m: Number(e.target.value) || null })
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-violet-600"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    0 にすると点として扱います。敷地全体を示したいときに広げてください
                  </p>
                </div>

                {/* 駐車区画。ここが「出発地（稼働開始を押す場所）」の正体になる */}
                <button
                  type="button"
                  onClick={() => {
                    const place = editingPlace;
                    setEditingPlace(null);
                    setSlotError("");
                    setSlotLabel("");
                    setSlotVehicleId("");
                    setSlotPlace(place);
                    // 区画は航空写真を見ながら合わせる（ユーザー方針 2026-08-10）
                    setViewPrefs((prev) => ({ ...prev, basemap: "satellite" }));
                    mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 19, duration: 700 });
                  }}
                  className="mt-3 flex w-full items-center justify-between rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-1.5">
                    <FontAwesomeIcon icon={faSquareParking} className="h-3 w-3" />
                    駐車区画を設定
                  </span>
                  <span className="text-[10px] font-normal text-slate-400">
                    {slots.filter((sl) => sl.place_id === editingPlace.id).length} 区画
                  </span>
                </button>

                {placeEditError && <div className="mt-2 text-[11px] text-red-600">{placeEditError}</div>}

                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(editingPlace)}
                    className="text-[11px] font-semibold text-red-600 hover:underline"
                  >
                    削除
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPlace(null);
                        setPlaceEditError("");
                        void refreshPlaces(); // ドラッグした位置を元に戻す
                      }}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => void savePlaceEdit()}
                      disabled={savingPlace || !editingPlace.name.trim()}
                      className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {savingPlace ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ピン追加フォーム（位置決定後） */}
            {draft && (
              <div className="absolute inset-x-3 bottom-3 mx-auto w-full max-w-sm rounded-xl bg-white p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">拠点を追加</span>
                  <span className="text-[10px] text-slate-400">位置はドラッグで微調整できます</span>
                </div>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveDraft();
                  }}
                  placeholder="名称（例: サンパルク伏見桃山 12番）"
                  maxLength={50}
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                />
                <div className="mt-2 flex gap-1.5">
                  {(Object.keys(PLACE_ICONS) as PlaceIcon[]).map((key) => {
                    const meta = PLACE_ICONS[key];
                    const active = draftIcon === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDraftIcon(key)}
                        className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-[10px] font-semibold transition-colors ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 text-slate-500 hover:border-slate-400"
                        }`}
                      >
                        <FontAwesomeIcon icon={meta.icon} className="h-3.5 w-3.5" />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                {draftError && <div className="mt-2 text-[11px] text-red-600">{draftError}</div>}
                <div className="mt-2.5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setDraftName("");
                      setDraftError("");
                    }}
                    className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={savingDraft}
                    className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {savingDraft ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            )}

            {isLoading && !data && (
              <div className="absolute inset-0 bg-white/60 p-4">
                <Skeleton className="h-full w-full rounded-lg" />
              </div>
            )}
            </div>
            {mapMode === "movements" && (
              <div className="lg:hidden">
                <MovementDetailCard
                  movement={selectedMovement}
                  vehicle={selectedVehicle}
                  upcomingUse={selectedUpcomingUse}
                  places={operationsData?.places ?? []}
                  canDispatch={canDispatch}
                  completing={completingMovement}
                  completionPlaceId={completionPlaceId}
                  saving={movementSaving}
                  error={movementError}
                  onEdit={() => selectedMovement && openMovementForm(selectedMovement)}
                  onStartComplete={() => {
                    setMovementError("");
                    setCompletionPlaceId(selectedMovement?.toPlaceId ?? "");
                    setCompletingMovement(true);
                  }}
                  onCompletionPlaceChange={setCompletionPlaceId}
                  onComplete={() => void finishMovement()}
                  onCancelComplete={() => setCompletingMovement(false)}
                  onCancel={() => selectedMovement && setCancelMovement(selectedMovement)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 地図の設定モーダル */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-900">地図の設定</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="閉じる"
              >
                <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <div className="mb-1 text-xs font-bold text-slate-700">地図の表示</div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs font-semibold text-slate-700">ベースマップ</span>
                  <div className="flex overflow-hidden rounded-lg bg-slate-100 p-0.5">
                    {(
                      [
                        { key: "standard", label: "標準" },
                        { key: "satellite", label: "航空写真" },
                      ] as const
                    ).map((b) => (
                      <button
                        key={b.key}
                        type="button"
                        onClick={() => setViewPrefs((p) => ({ ...p, basemap: b.key }))}
                        className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                          viewPrefs.basemap === b.key
                            ? "bg-slate-900 text-white"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-slate-50">
                  <SwitchRow
                    label="地名"
                    note="市区町名・山や川の名前"
                    checked={viewPrefs.placeLabels}
                    onChange={(v) => setViewPrefs((p) => ({ ...p, placeLabels: v }))}
                  />
                  <SwitchRow
                    label="道路名・路線番号"
                    checked={viewPrefs.roadLabels}
                    onChange={(v) => setViewPrefs((p) => ({ ...p, roadLabels: v }))}
                  />
                  <SwitchRow
                    label="施設名（POI）"
                    checked={viewPrefs.poiLabels}
                    onChange={(v) => setViewPrefs((p) => ({ ...p, poiLabels: v }))}
                  />
                  <SwitchRow
                    label="交通機関（駅・バス停）"
                    checked={viewPrefs.transitLabels}
                    onChange={(v) => setViewPrefs((p) => ({ ...p, transitLabels: v }))}
                  />
                  <SwitchRow
                    label="3D建物・ランドマーク"
                    note={
                      viewPrefs.basemap === "satellite" ? "航空写真では変更できません" : undefined
                    }
                    disabled={viewPrefs.basemap === "satellite"}
                    checked={viewPrefs.objects3d}
                    onChange={(v) => setViewPrefs((p) => ({ ...p, objects3d: v }))}
                  />
                  <SwitchRow
                    label="3D地形（山の起伏）"
                    note="3D視点と組み合わせると立体的になります"
                    checked={viewPrefs.terrain}
                    onChange={(v) => setViewPrefs((p) => ({ ...p, terrain: v }))}
                  />
                </div>
              </div>

              <div>
                <SwitchRow
                  label="拠点ピンを表示"
                  checked={showPlaces}
                  onChange={(v) => setShowPlaces(v)}
                />
                <div className="mb-1.5 text-xs font-bold text-slate-700">拠点ピン</div>
                {places.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] text-slate-400">
                    まだ拠点がありません。下のボタンから地図にピンを打って追加できます。
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {places.map((place) => {
                      const meta = PLACE_ICONS[place.icon] ?? PLACE_ICONS.pin;
                      return (
                        <li key={place.id} className="flex items-center gap-2.5 px-3 py-2">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${meta.bg}`}
                          >
                            <FontAwesomeIcon icon={meta.icon} className="h-3 w-3 text-white" />
                          </span>
                          <button
                            type="button"
                            onClick={() => flyToPlace(place)}
                            className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-700 hover:text-violet-700"
                            title="この拠点へ移動"
                          >
                            {place.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(place)}
                            className="shrink-0 text-slate-300 transition-colors hover:text-red-500"
                            aria-label={`${place.name} を削除`}
                          >
                            <FontAwesomeIcon icon={faTrashCan} className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    setAdding(true);
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                  地図にピンを打って追加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {movementForm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => !movementSaving && setMovementForm(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="movement-form-title"
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="movement-form-title" className="text-base font-bold text-slate-900">
                  {movementForm.id ? "車両移動の手配を変更" : "車両移動を登録"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">予定を保存しても、車の現在位置は変わりません</p>
              </div>
              <button
                type="button"
                onClick={() => setMovementForm(null)}
                disabled={movementSaving}
                className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-slate-700"
                aria-label="閉じる"
              >
                <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block text-xs font-bold text-slate-700">
                車両
                <select
                  value={movementForm.vehicleId}
                  disabled={movementForm.id != null}
                  onChange={(event) => setMovementForm({ ...movementForm, vehicleId: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                >
                  <option value="">選んでください</option>
                  {(data?.vehicles ?? []).map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>{plateText(vehicle)}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
                <label className="block min-w-0 text-xs font-bold text-slate-700">
                  出発地
                  <select
                    value={movementForm.fromPlaceId}
                    onChange={(event) => setMovementForm({ ...movementForm, fromPlaceId: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                  >
                    <option value="">選択</option>
                    {(operationsData?.places ?? []).map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
                  </select>
                </label>
                <FontAwesomeIcon icon={faArrowRight} className="mb-4 h-3.5 w-3.5 text-amber-600" />
                <label className="block min-w-0 text-xs font-bold text-slate-700">
                  届け先
                  <select
                    value={movementForm.toPlaceId}
                    onChange={(event) => setMovementForm({ ...movementForm, toPlaceId: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                  >
                    <option value="">選択</option>
                    {(operationsData?.places ?? []).map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
                  </select>
                </label>
              </div>

              <label className="block text-xs font-bold text-slate-700">
                運ぶ人
                <select
                  value={movementForm.assigneeDriverId}
                  onChange={(event) => setMovementForm({ ...movementForm, assigneeDriverId: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">未設定（要確認にする）</option>
                  {(operationsData?.drivers ?? []).map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                </select>
              </label>

              <div>
                <p className="text-xs font-bold text-slate-700">届ける期限</p>
                <div className="mt-1 grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                  <DatePicker
                    ariaLabel="届ける日"
                    value={reportDateStrToDate(movementForm.dueDate)}
                    displayFormat="yyyy/M/d（E）"
                    onChange={(value) => value && setMovementForm({ ...movementForm, dueDate: dateToReportDateStr(value) })}
                    className="min-h-11 w-full"
                  />
                  <div aria-label="届ける時刻">
                    <TimePicker
                      value={movementForm.dueTime}
                      onChange={(value) => value && setMovementForm({ ...movementForm, dueTime: value })}
                      minuteStep={5}
                      clearable={false}
                      buttonClassName="min-h-11"
                    />
                  </div>
                </div>
              </div>

              <label className="block text-xs font-bold text-slate-700">
                連絡メモ（任意）
                <textarea
                  value={movementForm.note}
                  maxLength={200}
                  rows={3}
                  onChange={(event) => setMovementForm({ ...movementForm, note: event.target.value })}
                  placeholder="鍵の場所など"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              {movementError && <p className="text-xs font-semibold text-red-600">{movementError}</p>}
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white px-5 py-4">
              <button
                type="button"
                disabled={movementSaving}
                onClick={() => setMovementForm(null)}
                className="min-h-11 flex-1 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={movementSaving}
                onClick={() => void saveMovement()}
                className="min-h-11 flex-1 rounded-lg bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {movementSaving ? "保存中..." : movementForm.assigneeDriverId ? "手配を保存" : "要確認で保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        title="拠点の削除"
        message={`「${deleteTarget?.name ?? ""}」を削除しますか?`}
        confirmLabel="削除"
        onConfirm={() => {
          if (deleteTarget) void deletePlace(deleteTarget);
          setEditingPlace(null);
        }}
        onClose={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={cancelMovement != null}
        title="車両移動の手配を取り消す"
        message="この手配だけを取り消します。配車や車の現在位置は変更しません。"
        confirmLabel="手配を取り消す"
        onConfirm={() => {
          const target = cancelMovement;
          setCancelMovement(null);
          if (!target) return;
          void (async () => {
            try {
              await apiFetch("/api/admin/map/movements", {
                method: "PATCH",
                body: JSON.stringify({
                  id: target.id,
                  expectedVersion: target.version,
                  action: "cancel",
                }),
              });
              setMovementError("");
              await mutateOperations();
            } catch (error) {
              setMovementError(error instanceof Error ? error.message : "取り消せませんでした");
            }
          })();
        }}
        onClose={() => setCancelMovement(null)}
      />
    </AdminLayout>
  );
}
