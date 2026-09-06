"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faCarSide,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faClockRotateLeft,
  faCrosshairs,
  faCube,
  faFilter,
  faLocationDot,
  faMagnifyingGlass,
  faPen,
  faRoute,
  faRotateRight,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { AdminPreviewLayout } from "@/app/preview/driver-leases/AdminPreviewLayout";
import { PREVIEW_MAPBOX_ENABLED, PREVIEW_MAPBOX_TOKEN } from "@/app/preview/driver-leases/mapbox-config";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { AerialMovementArrow } from "@/lib/components/AerialMovementArrow";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { DatePicker } from "@/lib/components/DatePicker";
import { EditorModal } from "@/lib/components/EditorModal";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { VehiclePlate, formatPlateNumeric } from "@/lib/components/VehiclePlate";
import { renderPlateImage } from "@/lib/plateImage";
import { TimePicker } from "@/lib/ui/time-picker";
import {
  PREVIEW_PLACES,
  PREVIEW_HISTORY_DEFAULT_AT,
  vehicleMapPresentation,
  needsAttention,
  needsVehicleRelocation,
  placeById,
  positionForMode,
  positionRecordAt,
  vehiclesForScenario,
  type MapMode,
  type PreviewMapVehicle,
  type PreviewScenario,
  type VehicleMovement,
  type VehiclePositionRecord,
} from "./model";

const TINTED_MODEL_URL = "/models/acty-hh5-blockout-70-tinted.glb";
const FIXED_MODEL_URL = "/models/acty-hh5-blockout-70-fixed.glb";
const TINTED_MODEL_ID = "acty-hh5-blockout-70-tinted";
const FIXED_MODEL_ID = "acty-hh5-blockout-70-fixed";
const TINTED_MODEL_LAYER_ID = "preview-vehicles-3d-tinted";
const FIXED_MODEL_LAYER_ID = "preview-vehicles-3d-fixed";
const PLATE_MODEL_LAYER_ID = "preview-vehicles-3d-plate";
const VEHICLE_CONTRAST_LAYER_ID = "preview-vehicle-contrast";
const PLATE_MODEL_VEHICLE_IDS = ["acty-1201", "acty-2752", "acty-4303", "acty-5854"] as const;
const plateModelId = (vehicleId: string) => `acty-hh5-plate-${vehicleId}`;
const plateModelUrl = (vehicleId: string) => `/models/${plateModelId(vehicleId)}.glb`;

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const historySourceLabel: Record<VehiclePositionRecord["source"], string> = {
  daily_report: "日報の駐車記録",
  manual: "管理者の手動記録",
  punch: "打刻時の位置",
};

const dateValue = (value: string) => new Date(`${value}T12:00:00`);
const dateString = (value: Date) => [
  value.getFullYear(),
  String(value.getMonth() + 1).padStart(2, "0"),
  String(value.getDate()).padStart(2, "0"),
].join("-");

const plateLabel = (vehicle: PreviewMapVehicle) =>
  `${vehicle.number_prefix ?? ""} ${vehicle.number_class ?? ""} ${vehicle.number_hiragana ?? ""} ${formatPlateNumeric(vehicle.number_numeric ?? "")}`.trim();

type MapPlateImage = {
  src: string;
  width: number;
  height: number;
  padding: number;
};

const mapPlateImageCache = new Map<string, Promise<MapPlateImage>>();
const mapPlateImageKey = (vehicle: PreviewMapVehicle) => [
  vehicle.number_prefix,
  vehicle.number_class,
  vehicle.number_hiragana,
  vehicle.number_numeric,
  vehicle.plate_color,
].join("|");

function loadMapPlateImage(vehicle: PreviewMapVehicle) {
  const key = mapPlateImageKey(vehicle);
  const cached = mapPlateImageCache.get(key);
  if (cached) return cached;
  const promise = renderPlateImage(vehicle, 82).then(({ canvas, width, height, padding }) => ({
    src: canvas.toDataURL("image/png"),
    width: width + padding * 2,
    height: height + padding * 2,
    padding,
  }));
  mapPlateImageCache.set(key, promise);
  promise.catch(() => mapPlateImageCache.delete(key));
  return promise;
}

function VehicleMapMarker({
  vehicle,
  selected,
  attention,
}: {
  vehicle: PreviewMapVehicle;
  selected: boolean;
  attention: boolean;
}) {
  const imageKey = mapPlateImageKey(vehicle);
  const [plateImage, setPlateImage] = useState<MapPlateImage | null>(null);

  useEffect(() => {
    let active = true;
    loadMapPlateImage(vehicle).then((image) => {
      if (active) setPlateImage(image);
    }).catch((error) => {
      // 画像化できない場合も、既存のSVGプレートを表示して操作は維持する。
      console.warn("地図用ナンバー札を画像化できませんでした", error);
    });
    return () => {
      active = false;
    };
  }, [imageKey, vehicle]);

  return (
    <button
      type="button"
      aria-label={`${plateLabel(vehicle)}を選択`}
      className={`relative isolate block h-[41px] w-[82px] rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${selected ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white/90" : "hover:ring-2 hover:ring-white/90"}`}
      style={{ transform: "translateZ(0)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
    >
      {plateImage ? (
        <img
          aria-hidden
          alt=""
          draggable={false}
          src={plateImage.src}
          data-map-plate-rendering="bitmap"
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            left: -plateImage.padding,
            top: -plateImage.padding,
            width: plateImage.width,
            height: plateImage.height,
          }}
        />
      ) : (
        <VehiclePlate vehicle={vehicle} compact glow={false} className="!max-w-none w-full pointer-events-none" />
      )}
      <span aria-hidden className="absolute left-1/2 top-full h-2 w-px -translate-x-1/2 bg-white shadow" />
      {attention && (
        <span className="absolute left-1/2 top-[-20px] -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500 px-1.5 py-0.5 text-[8px] font-bold text-amber-950 shadow-sm ring-1 ring-white">
          要確認
        </span>
      )}
    </button>
  );
}

function createVehicleMarker(vehicle: PreviewMapVehicle, selected: boolean, attention: boolean) {
  const element = document.createElement("div");
  element.style.zIndex = "5";
  element.style.opacity = "1";
  element.style.transition = "none";
  element.style.backfaceVisibility = "hidden";
  element.style.setProperty("-webkit-backface-visibility", "hidden");
  const root = createRoot(element);
  root.render(<VehicleMapMarker vehicle={vehicle} selected={selected} attention={attention} />);
  return { element, root };
}

type VehicleMarkerRecord = {
  marker: mapboxgl.Marker;
  root: Root;
  position: [number, number];
  offsetPixels: number;
};

function DesignSummary({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        id="map-design-summary-trigger"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="map-design-summary"
        className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-amber-300">
          <FontAwesomeIcon icon={faRoute} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-800">この画面で確かめる設計</span>
          <span className="block text-xs text-slate-500">予定と実際の場所を分け、選んだ1台だけ詳しく見る</span>
        </span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`size-3 text-slate-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <SmoothCollapse open={open} id="map-design-summary" labelledBy="map-design-summary-trigger" speed="quick">
        <div className="border-t border-slate-200 px-4 py-4">
          <div className="grid gap-3 text-xs md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
            <div>
              <p className="font-semibold text-slate-800">シフト</p>
              <p className="mt-1 leading-5 text-slate-500">次に誰が、どこで使うか</p>
            </div>
            <FontAwesomeIcon icon={faArrowRight} className="hidden text-slate-300 md:block" />
            <div>
              <p className="font-semibold text-slate-800">移動の手配</p>
              <p className="mt-1 leading-5 text-slate-500">誰が、いつまでに運ぶか</p>
            </div>
            <FontAwesomeIcon icon={faArrowRight} className="hidden text-slate-300 md:block" />
            <div>
              <p className="font-semibold text-slate-800">日報・将来QR</p>
              <p className="mt-1 leading-5 text-slate-500">実際に停めた場所を記録</p>
            </div>
          </div>
          <p className="mt-3 border-l-2 border-amber-400 pl-3 text-xs leading-5 text-slate-600">
            地図は判断する場所です。配車の正本はシフト、駐車の実績は記録から受け取ります。
            3D車両は識別を助けますが、色や灯火だけで状態を伝えません。
          </p>
        </div>
      </SmoothCollapse>
    </section>
  );
}

function DetailPanel({
  vehicle,
  movement,
  mode,
  historyAt,
  historyRecord,
  onEditMovement,
  onRecordParking,
}: {
  vehicle: PreviewMapVehicle;
  movement: VehicleMovement | null;
  mode: MapMode;
  historyAt: string;
  historyRecord: VehiclePositionRecord | null;
  onEditMovement: () => void;
  onRecordParking: () => void;
}) {
  const isHistory = mode === "history";
  const lastPlace = placeById(vehicle.lastParked?.placeId);
  const historyPlace = placeById(historyRecord?.placeId);
  const nextPlace = placeById(vehicle.nextUse?.placeId);
  const fromPlace = placeById(movement?.fromPlaceId);
  const toPlace = placeById(movement?.toPlaceId);
  const attention = needsAttention({ ...vehicle, movement });

  return (
    <aside className="flex min-h-0 flex-col bg-white lg:h-[640px] lg:border-l lg:border-slate-200">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-start gap-3">
          <VehiclePlate vehicle={vehicle} compact glow={false} className="w-[112px] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{vehicle.brand} {vehicle.modelCode}</p>
            <p className="mt-1 text-xs text-slate-500">暫定完成版 3Dモデル</p>
            <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${isHistory ? "bg-slate-100 text-slate-700" : attention ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
              <FontAwesomeIcon icon={isHistory ? faClockRotateLeft : attention ? faTriangleExclamation : faCheck} className="size-3" />
              {isHistory ? `${formatDateTime(historyAt)}時点` : attention ? "確認が必要" : "次の利用に向けて手配済み"}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
        {isHistory ? (
          <>
            <section className="border-b border-slate-200 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <FontAwesomeIcon icon={faLocationDot} className="size-3 text-emerald-600" />
                その時点の位置
              </div>
              {historyRecord ? (
                <>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{historyPlace?.name ?? "記録された位置"}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(historyRecord.at)}　{historyRecord.recordedBy}が記録</p>
                  <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                    {historySourceLabel[historyRecord.source]}
                  </p>
                </>
              ) : (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800">この時刻以前の記録はありません</p>
                  <p className="mt-1 text-xs text-slate-600">次の記録へ進むと位置を確認できます。</p>
                </div>
              )}
            </section>
            <section className="px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <FontAwesomeIcon icon={faClockRotateLeft} className="size-3" />
                履歴の見方
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                指定日時より前の、最後の記録を表示しています。記録と記録の間の動きは推測していません。
              </p>
            </section>
          </>
        ) : (
          <>
            <section className="border-b border-slate-200 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <FontAwesomeIcon icon={faLocationDot} className="size-3 text-emerald-600" />
                最後の駐車
              </div>
              {vehicle.lastParked && lastPlace ? (
                <>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{lastPlace.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(vehicle.lastParked.at)}　{vehicle.lastParked.recordedBy}が記録
                  </p>
                </>
              ) : (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-sm font-semibold text-amber-900">駐車場所が未記録です</p>
                  <p className="mt-1 text-xs text-amber-800">実際に停めた場所を確認してください。</p>
                </div>
              )}
            </section>

            <section className="border-b border-slate-200 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <FontAwesomeIcon icon={faCarSide} className="size-3" />
                次の利用
              </div>
              {vehicle.nextUse && nextPlace ? (
                <>
                  <p className="mt-2 text-base font-semibold text-slate-900">{nextPlace.name}で受取</p>
                  <p className="mt-1 text-sm text-slate-700">{formatDateTime(vehicle.nextUse.at)}　{vehicle.nextUse.driver}</p>
                  <p className="mt-1 text-xs text-slate-500">{vehicle.nextUse.course}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-500">次の利用予定はありません</p>
              )}
            </section>

            <section className="px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <FontAwesomeIcon icon={faRoute} className="size-3 text-amber-600" />
                移動の手配
              </div>
              {movement && fromPlace && toPlace ? (
                <div className="mt-2">
                  <p className="text-base font-semibold text-slate-900">{fromPlace.name} → {toPlace.name}</p>
                  <p className="mt-1 text-sm text-slate-700">{formatDateTime(movement.dueAt)}まで</p>
                  <dl className="mt-3 grid grid-cols-[76px_1fr] gap-y-2 text-xs">
                    <dt className="text-slate-500">運ぶ人</dt>
                    <dd className={movement.assignee ? "text-slate-800" : "font-semibold text-amber-700"}>{movement.assignee ?? "未設定"}</dd>
                    <dt className="text-slate-500">状態</dt>
                    <dd className="text-slate-800">{movement.status === "arrived" ? "到着済み" : movement.status === "planned" ? "手配済み" : "手配が必要"}</dd>
                  </dl>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">移動の手配はありません</p>
              )}
            </section>
          </>
        )}
      </div>

      {!isHistory && (
        <div className="grid shrink-0 gap-2 border-t border-slate-200 bg-white p-3">
          <button type="button" onClick={onRecordParking} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2">
            停めた場所を記録
          </button>
          <button type="button" onClick={onEditMovement} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2">
            手配を変更
          </button>
        </div>
      )}
    </aside>
  );
}

export function MapOperationsPreview() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const vehicleMarkersRef = useRef(new Map<string, VehicleMarkerRecord>());
  const [mapReady, setMapReady] = useState(false);
  const [mode, setMode] = useState<MapMode>("current");
  const [scenario, setScenario] = useState<PreviewScenario>("normal");
  const [selectedId, setSelectedId] = useState("acty-1201");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [designOpen, setDesignOpen] = useState(false);
  const [is3d, setIs3d] = useState(true);
  const [historyDate, setHistoryDate] = useState(PREVIEW_HISTORY_DEFAULT_AT.slice(0, 10));
  const [historyTime, setHistoryTime] = useState(PREVIEW_HISTORY_DEFAULT_AT.slice(11, 16));
  const [editor, setEditor] = useState<"movement" | "parking" | null>(null);
  const [movementOverrides, setMovementOverrides] = useState<Record<string, VehicleMovement | null>>({});
  const [parkingOverrides, setParkingOverrides] = useState<Record<string, { placeId: string; at: string; recordedBy: string }>>({});
  const [movementPlaceId, setMovementPlaceId] = useState("kyoto");
  const [movementAssignee, setMovementAssignee] = useState("高橋");
  const [movementTime, setMovementTime] = useState<string | null>("06:30");
  const [notifyPreviousDay, setNotifyPreviousDay] = useState(true);
  const [parkingPlaceId, setParkingPlaceId] = useState("toyonaka");
  const [parkingTime, setParkingTime] = useState<string | null>("20:10");
  const [toast, setToast] = useState<string | null>(null);

  const vehicles = useMemo(
    () => vehiclesForScenario(scenario).map((vehicle) => parkingOverrides[vehicle.id]
      ? {
          ...vehicle,
          position: placeById(parkingOverrides[vehicle.id].placeId)?.coordinates ?? vehicle.position,
          positionHistory: [
            ...vehicle.positionHistory,
            {
              at: parkingOverrides[vehicle.id].at,
              coordinates: placeById(parkingOverrides[vehicle.id].placeId)?.coordinates ?? vehicle.position!,
              placeId: parkingOverrides[vehicle.id].placeId,
              recordedBy: parkingOverrides[vehicle.id].recordedBy,
              source: "manual" as const,
            },
          ],
          lastParked: parkingOverrides[vehicle.id],
        }
      : vehicle),
    [scenario, parkingOverrides],
  );
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? vehicles[0];
  const selectedMovement = Object.prototype.hasOwnProperty.call(movementOverrides, selected.id)
    ? movementOverrides[selected.id]
    : selected.movement;
  const normalizedQuery = query.trim().replaceAll("-", "");
  const filteredVehicles = useMemo(() => vehicles.filter((vehicle) => {
    const movement = Object.prototype.hasOwnProperty.call(movementOverrides, vehicle.id)
      ? movementOverrides[vehicle.id]
      : vehicle.movement;
    const withMovement = { ...vehicle, movement };
    const matchesMode = mode !== "movements" || needsVehicleRelocation(movement);
    const matchesAttention = !attentionOnly || needsAttention(withMovement);
    const matchesQuery = !normalizedQuery || plateLabel(vehicle).replaceAll("-", "").includes(normalizedQuery)
      || vehicle.brand.includes(normalizedQuery);
    return matchesMode && matchesAttention && matchesQuery;
  }), [attentionOnly, mode, movementOverrides, normalizedQuery, vehicles]);
  const selectedIsVisible = filteredVehicles.some((vehicle) => vehicle.id === selected.id);
  const historyAt = `${historyDate}T${historyTime}:00+09:00`;
  const selectedHistoryRecord = positionRecordAt(selected, historyAt);
  const historyMoments = useMemo(() => [...new Set(
    vehicles.flatMap((vehicle) => vehicle.positionHistory.map((record) => record.at)),
  )].sort(), [vehicles]);
  const previousHistoryAt = [...historyMoments].reverse().find((at) => at < historyAt) ?? null;
  const nextHistoryAt = historyMoments.find((at) => at > historyAt) ?? null;
  const historyVehicleCount = filteredVehicles.filter((vehicle) => positionRecordAt(vehicle, historyAt)).length;
  const movementFrom = selected.position;
  const movementTo = placeById(selectedMovement?.toPlaceId)?.coordinates ?? null;

  const selectMode = (nextMode: MapMode) => {
    setMode(nextMode);
    if (nextMode === "history") setAttentionOnly(false);
    if (nextMode !== "movements" || needsVehicleRelocation(selectedMovement)) return;
    const firstMovingVehicle = vehicles.find((vehicle) => {
      const movement = Object.prototype.hasOwnProperty.call(movementOverrides, vehicle.id)
        ? movementOverrides[vehicle.id]
        : vehicle.movement;
      return needsVehicleRelocation(movement);
    });
    if (firstMovingVehicle) setSelectedId(firstMovingVehicle.id);
  };

  const selectHistoryMoment = (at: string) => {
    setHistoryDate(at.slice(0, 10));
    setHistoryTime(at.slice(11, 16));
  };

  const resetPreview = useCallback(() => {
    setMode("current");
    setScenario("normal");
    setSelectedId("acty-1201");
    setAttentionOnly(false);
    setQuery("");
    setMovementOverrides({});
    setParkingOverrides({});
    setDesignOpen(false);
    setIs3d(true);
    setHistoryDate(PREVIEW_HISTORY_DEFAULT_AT.slice(0, 10));
    setHistoryTime(PREVIEW_HISTORY_DEFAULT_AT.slice(11, 16));
    setEditor(null);
    setToast(null);
    mapRef.current?.flyTo({ center: [135.56, 34.83], zoom: 10.8, pitch: 56, bearing: -14, duration: 700 });
  }, []);

  useEffect(() => {
    if (!containerRef.current || !PREVIEW_MAPBOX_ENABLED || mapRef.current) return;
    mapboxgl.accessToken = PREVIEW_MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/standard",
      config: {
        basemap: {
          lightPreset: "day",
          showPointOfInterestLabels: false,
          showTransitLabels: false,
          show3dObjects: false,
        },
      },
      center: [135.56, 34.83],
      zoom: 10.8,
      maxZoom: 24,
      pitch: 56,
      bearing: -14,
      antialias: true,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
    let presentationFrame: number | null = null;
    let forcePresentationUpdate = false;
    let lastPresentation: ReturnType<typeof vehicleMapPresentation> | null = null;
    const updatePresentation = () => {
      presentationFrame = null;
      if (!map.getLayer(TINTED_MODEL_LAYER_ID) || !map.getLayer(FIXED_MODEL_LAYER_ID) || !map.getLayer(PLATE_MODEL_LAYER_ID)) return;
      const presentation = vehicleMapPresentation({
        mapWidthPixels: map.getContainer().clientWidth,
        zoom: map.getZoom(),
        latitude: map.getCenter().lat,
      });
      const scaleChanged = forcePresentationUpdate || !lastPresentation
        || Math.abs(presentation.modelScale - lastPresentation.modelScale) > Math.max(0.002, presentation.modelScale * 0.001);
      const contrastChanged = forcePresentationUpdate || !lastPresentation
        || Math.abs(presentation.contrastRadiusPixels - lastPresentation.contrastRadiusPixels) >= 0.1;
      const offsetChanged = forcePresentationUpdate || !lastPresentation
        || Math.abs(presentation.markerOffsetPixels - lastPresentation.markerOffsetPixels) >= 0.25;
      forcePresentationUpdate = false;

      if (scaleChanged) {
        const scale = presentation.modelScale;
        map.setPaintProperty(TINTED_MODEL_LAYER_ID, "model-scale", [scale, scale, scale]);
        map.setPaintProperty(FIXED_MODEL_LAYER_ID, "model-scale", [scale, scale, scale]);
        map.setPaintProperty(PLATE_MODEL_LAYER_ID, "model-scale", [scale, scale, scale]);
      }
      if (contrastChanged && map.getLayer(VEHICLE_CONTRAST_LAYER_ID)) {
        map.setPaintProperty(VEHICLE_CONTRAST_LAYER_ID, "circle-radius", presentation.contrastRadiusPixels);
      }
      if (offsetChanged) {
        vehicleMarkersRef.current.forEach((record) => {
          if (Math.abs(record.offsetPixels - presentation.markerOffsetPixels) < 0.25) return;
          record.marker.setOffset([0, -presentation.markerOffsetPixels]);
          record.offsetPixels = presentation.markerOffsetPixels;
        });
      }
      lastPresentation = presentation;
    };
    const schedulePresentation = (force = false) => {
      forcePresentationUpdate ||= force;
      if (presentationFrame !== null) return;
      presentationFrame = window.requestAnimationFrame(updatePresentation);
    };
    const handleZoom = () => schedulePresentation();
    const handleResize = () => schedulePresentation(true);
    const handleMoveEnd = () => schedulePresentation();

    const addLayers = () => {
      map.setConfigProperty("basemap", "lightPreset", "day");
      map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
      map.setConfigProperty("basemap", "showTransitLabels", false);
      map.setConfigProperty("basemap", "show3dObjects", false);
      if (!map.hasModel(TINTED_MODEL_ID)) map.addModel(TINTED_MODEL_ID, TINTED_MODEL_URL);
      if (!map.hasModel(FIXED_MODEL_ID)) map.addModel(FIXED_MODEL_ID, FIXED_MODEL_URL);
      for (const vehicleId of PLATE_MODEL_VEHICLE_IDS) {
        const modelId = plateModelId(vehicleId);
        if (!map.hasModel(modelId)) map.addModel(modelId, plateModelUrl(vehicleId));
      }
      if (!map.getSource("preview-vehicles")) {
        map.addSource("preview-vehicles", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      if (!map.getLayer(VEHICLE_CONTRAST_LAYER_ID)) {
        map.addLayer({
          id: VEHICLE_CONTRAST_LAYER_ID,
          type: "circle",
          source: "preview-vehicles",
          paint: {
            "circle-radius": 24,
            "circle-color": "#ffffff",
            "circle-opacity": 0.62,
            "circle-stroke-color": "#334155",
            "circle-stroke-opacity": 0.72,
            "circle-stroke-width": 1.5,
            "circle-pitch-alignment": "map",
            "circle-pitch-scale": "viewport",
          },
        });
      }
      if (!map.getLayer(TINTED_MODEL_LAYER_ID)) {
        map.addLayer({
          id: TINTED_MODEL_LAYER_ID,
          type: "model",
          source: "preview-vehicles",
          layout: { "model-id": TINTED_MODEL_ID },
          paint: {
            "model-rotation": ["get", "rotation"],
            "model-color": ["get", "color"],
            "model-color-mix-intensity": 0.86,
            "model-emissive-strength": 0.45,
          },
        });
      }
      if (!map.getLayer(FIXED_MODEL_LAYER_ID)) {
        map.addLayer({
          id: FIXED_MODEL_LAYER_ID,
          type: "model",
          source: "preview-vehicles",
          layout: { "model-id": FIXED_MODEL_ID },
          paint: {
            "model-rotation": ["get", "rotation"],
            "model-emissive-strength": 0.45,
          },
        });
      }
      if (!map.getLayer(PLATE_MODEL_LAYER_ID)) {
        map.addLayer({
          id: PLATE_MODEL_LAYER_ID,
          type: "model",
          source: "preview-vehicles",
          layout: { "model-id": ["get", "plateModel"] },
          paint: {
            "model-rotation": ["get", "rotation"],
            "model-emissive-strength": 0.7,
          },
        });
      }
      lastPresentation = null;
      schedulePresentation(true);
      setMapReady(true);
    };
    map.on("style.load", addLayers);
    map.on("zoom", handleZoom);
    map.on("resize", handleResize);
    map.on("moveend", handleMoveEnd);
    return () => {
      map.off("style.load", addLayers);
      map.off("zoom", handleZoom);
      map.off("resize", handleResize);
      map.off("moveend", handleMoveEnd);
      if (presentationFrame !== null) window.cancelAnimationFrame(presentationFrame);
      const records = [...vehicleMarkersRef.current.values()];
      records.forEach(({ marker }) => marker.remove());
      vehicleMarkersRef.current.clear();
      const roots = records.map(({ root }) => root);
      setTimeout(() => roots.forEach((root) => root.unmount()), 0);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const located = filteredVehicles.flatMap((vehicle) => {
      const position = positionForMode(vehicle, mode, historyAt);
      return position ? [{ vehicle, position }] : [];
    });
    const source = map.getSource("preview-vehicles") as mapboxgl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: located.map(({ vehicle, position }, index) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: position },
        properties: {
          color: vehicle.bodyColor,
          plateModel: plateModelId(vehicle.id),
          rotation: [0, 0, 20 + index * 18],
        },
      })),
    });

    const activeVehicleIds = new Set(located.map(({ vehicle }) => vehicle.id));
    const staleRoots: Root[] = [];
    vehicleMarkersRef.current.forEach((record, vehicleId) => {
      if (activeVehicleIds.has(vehicleId)) return;
      record.marker.remove();
      staleRoots.push(record.root);
      vehicleMarkersRef.current.delete(vehicleId);
    });
    if (staleRoots.length > 0) setTimeout(() => staleRoots.forEach((root) => root.unmount()), 0);

    located.forEach(({ vehicle, position }) => {
      const movement = Object.prototype.hasOwnProperty.call(movementOverrides, vehicle.id)
        ? movementOverrides[vehicle.id]
        : vehicle.movement;
      const selectedMarker = vehicle.id === selectedId;
      const attention = mode !== "history" && needsAttention({ ...vehicle, movement });
      const existing = vehicleMarkersRef.current.get(vehicle.id);
      if (existing) {
        existing.root.render(<VehicleMapMarker vehicle={vehicle} selected={selectedMarker} attention={attention} />);
        if (existing.position[0] !== position[0] || existing.position[1] !== position[1]) {
          existing.marker.setLngLat(position);
          existing.position = position;
        }
        return;
      }

      const { element, root } = createVehicleMarker(vehicle, selectedMarker, attention);
      element.addEventListener("click", () => setSelectedId(vehicle.id));
      const presentation = vehicleMapPresentation({
        mapWidthPixels: map.getContainer().clientWidth,
        zoom: map.getZoom(),
        latitude: map.getCenter().lat,
      });
      const marker = new mapboxgl.Marker({
        element,
        anchor: "bottom",
        offset: [0, -presentation.markerOffsetPixels],
        occludedOpacity: 1,
        pitchAlignment: "viewport",
        rotationAlignment: "viewport",
      })
        .setLngLat(position)
        .addTo(map);
      vehicleMarkersRef.current.set(vehicle.id, {
        marker,
        root,
        position,
        offsetPixels: presentation.markerOffsetPixels,
      });
    });

  }, [filteredVehicles, historyAt, mapReady, mode, movementOverrides, selectedId]);

  useEffect(() => {
    if (mode !== "movements" || selectedIsVisible || filteredVehicles.length === 0) return;
    setSelectedId(filteredVehicles[0].id);
  }, [filteredVehicles, mode, selectedIsVisible]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const openMovementEditor = () => {
    setMovementPlaceId(selectedMovement?.toPlaceId ?? selected.nextUse?.placeId ?? "suita");
    setMovementAssignee(selectedMovement?.assignee ?? "");
    setMovementTime(selectedMovement?.dueAt.slice(11, 16) ?? "06:30");
    setEditor("movement");
  };

  const openParkingEditor = () => {
    setParkingPlaceId(selected.lastParked?.placeId ?? "toyonaka");
    setParkingTime(selected.lastParked?.at.slice(11, 16) ?? "20:10");
    setEditor("parking");
  };

  const focusSelectedVehicle = () => {
    const position = positionForMode(selected, mode, historyAt);
    if (!position) {
      setToast("この車両は駐車場所が未記録です");
      return;
    }
    mapRef.current?.flyTo({
      center: position,
      zoom: 16.8,
      pitch: is3d ? 60 : 0,
      bearing: -20,
      duration: 700,
    });
  };

  return (
    <AdminPreviewLayout pathname="/admin/map" onReset={resetPreview}>
      <div className="space-y-3">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900 md:text-2xl">車両地図</h1>
              <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">作戦盤プレビュー</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">最後の駐車と次の利用を見比べ、必要な移動を確認します。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">架空データ</span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">本番API・通知なし</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">Mapbox接続あり</span>
          </div>
        </header>

        <DesignSummary open={designOpen} onToggle={() => setDesignOpen((value) => !value)} />

        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-slate-100 p-1">
              {(["current", "movements", "history"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectMode(value)}
                  className={`min-h-9 rounded-md px-3 text-xs font-semibold ${mode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  <FontAwesomeIcon icon={value === "current" ? faLocationDot : value === "movements" ? faRoute : faClockRotateLeft} className="mr-1.5 size-3" />
                  {value === "current" ? "いま" : value === "movements" ? "車両移動" : "履歴"}
                </button>
              ))}
            </div>
            <label className="flex min-h-10 min-w-[210px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-slate-400">
              <FontAwesomeIcon icon={faMagnifyingGlass} className="size-3 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="車両番号・車種で探す" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
            </label>
            {mode !== "history" && (
              <button
                type="button"
                onClick={() => setAttentionOnly((value) => !value)}
                aria-pressed={attentionOnly}
                className={`min-h-10 rounded-lg border px-3 text-xs font-semibold ${attentionOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <FontAwesomeIcon icon={faFilter} className="mr-1.5 size-3" />
                要確認だけ
              </button>
            )}
            <CustomSelect
              value={scenario}
              onChange={(value) => setScenario(value as PreviewScenario)}
              clearable={false}
              size="sm"
              className="w-full sm:w-[190px]"
              ariaLabel="プレビューの状態"
              options={[
                { value: "normal", label: "通常の状態" },
                { value: "attention", label: "移動担当が未設定" },
                { value: "unrecorded", label: "駐車場所が未記録" },
              ]}
            />
          </div>
          {mode === "history" && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-full sm:w-auto">
                  <p className="mb-1 text-[11px] font-semibold text-slate-600">表示する日時</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:flex">
                    <DatePicker
                      ariaLabel="履歴の日付"
                      value={dateValue(historyDate)}
                      displayFormat="yyyy/M/d（E）"
                      fromDate={historyMoments[0] ? dateValue(historyMoments[0].slice(0, 10)) : undefined}
                      toDate={historyMoments.at(-1) ? dateValue(historyMoments.at(-1)!.slice(0, 10)) : undefined}
                      onChange={(value) => value && setHistoryDate(dateString(value))}
                      className="min-h-11 w-full sm:w-[164px]"
                    />
                    <div aria-label="履歴の時刻" className="sm:w-28">
                      <TimePicker value={historyTime} onChange={(value) => value && setHistoryTime(value)} minuteStep={5} clearable={false} buttonClassName="min-h-11" />
                    </div>
                  </div>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
                  <button
                    type="button"
                    disabled={!previousHistoryAt}
                    onClick={() => previousHistoryAt && selectHistoryMoment(previousHistoryAt)}
                    className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <FontAwesomeIcon icon={faChevronLeft} className="mr-1.5 size-3" />前の記録
                  </button>
                  <button
                    type="button"
                    disabled={!nextHistoryAt}
                    onClick={() => nextHistoryAt && selectHistoryMoment(nextHistoryAt)}
                    className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    次の記録<FontAwesomeIcon icon={faChevronRight} className="ml-1.5 size-3" />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                <span className="font-semibold text-slate-700">{formatDateTime(historyAt)}時点・{historyVehicleCount}台を表示。</span>
                各車両は、その時刻以前の最後の記録位置です。
              </p>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="relative min-w-0 bg-slate-100">
              {PREVIEW_MAPBOX_ENABLED ? (
                <div ref={containerRef} className="h-[54vh] min-h-[440px] w-full lg:h-[640px]" aria-label="車両地図" />
              ) : (
                <div className="flex h-[54vh] min-h-[440px] items-center justify-center p-6 text-center lg:h-[640px]">
                  <div>
                    <FontAwesomeIcon icon={faCube} className="size-10 text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">地図を表示するにはMapboxモードで起動します</p>
                    <p className="mt-1 text-xs text-slate-500">本番APIや通知には接続しません。</p>
                  </div>
                </div>
              )}
              <AerialMovementArrow
                map={mapReady ? mapRef.current : null}
                from={movementFrom}
                to={movementTo}
                visible={mode === "movements" && selectedIsVisible && needsVehicleRelocation(selectedMovement)}
              />
              <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2">
                <div className="flex rounded-lg bg-white/95 p-1 shadow backdrop-blur">
                  {([false, true] as const).map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => {
                        setIs3d(value);
                        mapRef.current?.easeTo({ pitch: value ? 56 : 0, duration: 500 });
                      }}
                      className={`min-h-8 rounded-md px-2.5 text-xs font-semibold ${is3d === value ? "bg-slate-900 text-white" : "text-slate-500"}`}
                    >
                      {value ? "3D" : "2D"}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => mapRef.current?.flyTo({ center: [135.56, 34.83], zoom: 10.8, pitch: is3d ? 56 : 0, bearing: -14, duration: 700 })} className="flex min-h-10 items-center rounded-lg bg-white/95 px-3 text-xs font-semibold text-slate-600 shadow backdrop-blur hover:text-slate-900">
                  <FontAwesomeIcon icon={faRotateRight} className="mr-1.5 size-3" />全体を見る
                </button>
                <button type="button" onClick={focusSelectedVehicle} className="flex min-h-10 items-center rounded-lg bg-white/95 px-3 text-xs font-semibold text-slate-600 shadow backdrop-blur hover:text-slate-900">
                  <FontAwesomeIcon icon={faCrosshairs} className="mr-1.5 size-3" />選択車両を見る
                </button>
              </div>
              <div className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-lg bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow backdrop-blur">
                <span className="mr-3 inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />{mode === "history" ? "指定時点の記録" : "最後の記録"}</span>
                {mode === "movements" && (
                  <span className="inline-flex items-center gap-1.5"><FontAwesomeIcon icon={faArrowRight} className="w-5 text-amber-600" />移動予定</span>
                )}
              </div>
            </div>
            <DetailPanel
              vehicle={selected}
              movement={selectedMovement}
              mode={mode}
              historyAt={historyAt}
              historyRecord={selectedHistoryRecord}
              onEditMovement={openMovementEditor}
              onRecordParking={openParkingEditor}
            />
          </div>
        </section>

        <p className="text-[11px] leading-5 text-slate-500">
          3DはアクティHH5 Blockout 70を使用。車両の長さは地図幅の約9%を保ち、実寸に届いた後は等倍で表示します。車体だけを強く着色し、窓・タイヤ・灯火は元の色です。ナンバーは同じSVG字形を地図上の札と前後のプレート面に使っています。
        </p>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}

      {editor === "movement" && (
        <EditorModal
          title="移動の手配を変更"
          variant="shift"
          onClose={() => setEditor(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditor(null)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">キャンセル</button>
              <button
                type="button"
                disabled={!movementAssignee || !movementTime}
                onClick={() => {
                  setMovementOverrides((current) => ({
                    ...current,
                    [selected.id]: {
                      fromPlaceId: selected.lastParked?.placeId ?? "toyonaka",
                      toPlaceId: movementPlaceId,
                      assignee: movementAssignee,
                      dueAt: `2026-09-03T${movementTime}:00+09:00`,
                      status: "planned",
                    },
                  }));
                  setEditor(null);
                  setToast("移動の手配を画面内に保存しました");
                }}
                className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                手配を保存
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">届け先</label>
              <CustomSelect value={movementPlaceId} onChange={setMovementPlaceId} clearable={false} size="md" options={PREVIEW_PLACES.map((place) => ({ value: place.id, label: place.name }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">運ぶ人</label>
              <CustomSelect value={movementAssignee} onChange={setMovementAssignee} clearable={false} size="md" placeholder="運ぶ人を選択" options={["佐藤", "田中", "高橋", "加藤"].map((name) => ({ value: name, label: name }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">9月3日（木）の届ける時刻</label>
              <TimePicker value={movementTime} onChange={setMovementTime} minuteStep={5} clearable={false} />
            </div>
            <CheckboxField checked={notifyPreviousDay} onCheckedChange={setNotifyPreviousDay} label="前日に担当者へ通知する" description="プレビューでは文面の確認だけで、通知は送りません。" variant="row" />
          </div>
        </EditorModal>
      )}

      {editor === "parking" && (
        <EditorModal
          title="停めた場所を記録"
          variant="shift"
          onClose={() => setEditor(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditor(null)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">キャンセル</button>
              <button
                type="button"
                disabled={!parkingTime}
                onClick={() => {
                  setParkingOverrides((current) => ({
                    ...current,
                    [selected.id]: { placeId: parkingPlaceId, at: `2026-09-02T${parkingTime}:00+09:00`, recordedBy: "サンプル管理者" },
                  }));
                  setEditor(null);
                  setToast("駐車場所を画面内に記録しました");
                }}
                className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                場所を記録
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">実際に停めた場所</label>
              <CustomSelect value={parkingPlaceId} onChange={setParkingPlaceId} clearable={false} size="md" options={PREVIEW_PLACES.map((place) => ({ value: place.id, label: place.name }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">9月2日（水）の時刻</label>
              <TimePicker value={parkingTime} onChange={setParkingTime} minuteStep={5} clearable={false} />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              予定と違う場所でも、実際に停めた場所を残します。移動の手配は別に確認します。
            </div>
          </div>
        </EditorModal>
      )}
    </AdminPreviewLayout>
  );
}
