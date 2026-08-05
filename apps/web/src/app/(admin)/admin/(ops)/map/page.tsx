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
import { createRoot, type Root } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBuilding,
  faGear,
  faLocationDot,
  faPlus,
  faRotateRight,
  faSquareParking,
  faTrashCan,
  faUsers,
  faWarehouse,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { Skeleton } from "@/lib/components/Skeleton";
import { useApi } from "@/lib/useApi";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { hasCapability } from "@/lib/capabilities";
import { todayJST } from "@/lib/date";
import { useSharedMapView } from "@/lib/map/sharedView";
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

// 拠点ピンのマーカー種別（DB の map_places.icon と対応）。
const PLACE_ICONS = {
  pin: { label: "拠点", icon: faLocationDot, bg: "bg-violet-600" },
  warehouse: { label: "倉庫", icon: faWarehouse, bg: "bg-amber-600" },
  parking: { label: "駐車場", icon: faSquareParking, bg: "bg-blue-600" },
  client: { label: "取引先", icon: faBuilding, bg: "bg-emerald-600" },
} as const;
type PlaceIcon = keyof typeof PLACE_ICONS;

type MapPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  icon: PlaceIcon;
};

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

// デモ車両の状態と表示色（実データ接続時は vehicle_sessions 等から導出する）。
const DEMO_STATUS_DOT = {
  稼働中: "bg-emerald-500",
  積み込み中: "bg-amber-400",
  休憩中: "bg-sky-400",
  稼働外: "bg-slate-500",
} as const;
type DemoStatus = keyof typeof DEMO_STATUS_DOT;

// 京都市内に適当に散らしたデモ車両（3Dモデル＋プレート吹き出しの実験用）。
const DEMO_VEHICLES: {
  id: string;
  lngLat: [number, number];
  rot: number;
  status: DemoStatus;
  plate: { prefix: string; cls: string; kana: string; num: string };
}[] = [
  // v01 はサンパルク伏見桃山12番に駐車している想定（座標はユーザー実測値。
  // rot は区画の向きに合わせて要調整 — 航空写真モードで見ながら合わせる）。
  { id: "v01", lngLat: [135.7594225, 34.945416], rot: 35, status: "稼働外", plate: { prefix: "京都", cls: "400", kana: "あ", num: "1234" } },
  { id: "v02", lngLat: [135.7585, 34.9868], rot: 120, status: "稼働中", plate: { prefix: "京都", cls: "480", kana: "あ", num: "4567" } },
  { id: "v03", lngLat: [135.7681, 35.0038], rot: 200, status: "積み込み中", plate: { prefix: "京都", cls: "480", kana: "い", num: "789" } },
  { id: "v04", lngLat: [135.748, 35.0142], rot: 80, status: "稼働中", plate: { prefix: "京都", cls: "400", kana: "う", num: "2468" } },
  { id: "v05", lngLat: [135.7593, 35.0455], rot: 300, status: "休憩中", plate: { prefix: "京都", cls: "480", kana: "え", num: "1357" } },
  { id: "v06", lngLat: [135.7292, 35.0394], rot: 15, status: "稼働中", plate: { prefix: "京都", cls: "400", kana: "お", num: "9012" } },
  { id: "v07", lngLat: [135.7096, 34.9836], rot: 260, status: "稼働中", plate: { prefix: "京都", cls: "480", kana: "か", num: "3456" } },
  { id: "v08", lngLat: [135.8163, 34.9718], rot: 145, status: "積み込み中", plate: { prefix: "京都", cls: "400", kana: "き", num: "6789" } },
  { id: "v09", lngLat: [135.7476, 34.9787], rot: 90, status: "休憩中", plate: { prefix: "京都", cls: "480", kana: "く", num: "159" } },
  { id: "v10", lngLat: [135.6828, 35.0094], rot: 330, status: "稼働外", plate: { prefix: "京都", cls: "400", kana: "け", num: "753" } },
];

// 車両の頭上ラベル: 吹き出し用に最適化した簡易プレート。黒ナンバー（事業用軽貨物）
// らしく黒地に黄文字。実車プレートの再現は popup 側の VehiclePlate に任せる。
// TODO: 数字・かなは将来 SVG グリフ化する（docs/roadmap-2026-07.md 参照）。
function VehicleLabel({ vehicle, status }: { vehicle: VehiclePlateData; status: DemoStatus }) {
  return (
    <>
      {/* 通常表示（吹き出し）。重なって負けたら .vl-collapsed でドットに縮退する */}
      <div className="vl-full flex flex-col items-center">
        <div className="min-w-[84px] rounded-xl bg-slate-950/95 px-2.5 pb-1 pt-1.5 text-center shadow-md ring-1 ring-white/10">
          <div
            className="text-[9px] font-semibold leading-none tracking-[0.15em]"
            style={{ color: "#e8d44d" }}
          >
            {vehicle.number_prefix || ""} {vehicle.number_class || ""}
          </div>
          <div
            className="mt-0.5 flex items-baseline justify-center gap-1 leading-none"
            style={{ color: "#e8d44d" }}
          >
            <span className="text-[11px] font-bold">{vehicle.number_hiragana || ""}</span>
            <span className="text-[17px] font-black tracking-wide">
              {formatPlateNumeric(vehicle.number_numeric || "")}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-center gap-1 text-[9px] font-bold text-slate-300">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${DEMO_STATUS_DOT[status]}`} />
            {status}
          </div>
        </div>
        <div className="h-0 w-0 border-x-[7px] border-t-[7px] border-x-transparent border-t-slate-950" />
      </div>
      {/* 縮退表示: 状態色ドット（存在と状態だけは常に示す） */}
      <div className="vl-dot flex flex-col items-center">
        <span
          className={`block h-3 w-3 rounded-full border-2 border-white shadow-md ${DEMO_STATUS_DOT[status]}`}
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
  /** 履歴モード（Stage 0.6）。null = ライブ（現在） */
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  /** 履歴モードの時刻（0:00 からの分） */
  const [historyMinute, setHistoryMinute] = useState(12 * 60);

  // 履歴モードでは as-of（その時刻の位置）を取りに行く。ライブは従来どおり最新。
  const asOfIso = useMemo(() => {
    if (!historyDate) return null;
    const h = String(Math.floor(historyMinute / 60)).padStart(2, "0");
    const m = String(historyMinute % 60).padStart(2, "0");
    return new Date(`${historyDate}T${h}:${m}:00+09:00`).toISOString();
  }, [historyDate, historyMinute]);

  const { data, isLoading, mutate } = useApi<{ vehicles: MapVehicle[] }>(
    asOfIso ? `/api/admin/map/vehicles?at=${encodeURIComponent(asOfIso)}` : "/api/admin/map/vehicles",
    // 履歴は勝手に更新されない方が読みやすい（ライブだけ自動更新）
    { refreshInterval: asOfIso ? 0 : 60000, keepPreviousData: true },
  );
  const { data: placesData, refresh: refreshPlaces } = useApi<{ places: MapPlace[] }>(
    "/api/admin/map/places",
  );
  const places = useMemo(() => placesData?.places ?? [], [placesData]);

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
  useEffect(() => {
    setCanDispatch(hasCapability("can_dispatch"));
  }, []);
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

  // ピン追加フロー: adding=クリック待ち → draft=位置決定・名称入力中。
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState<PlaceIcon>("pin");
  const [draftError, setDraftError] = useState("");
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

    // 3Dモデルの実験: 京都市内にデモ車両を10台置く（DEMO_VEHICLES）。
    // モデルは Kenney Car Kit の delivery van（CC0）。実寸 3.25×1.5×1.65m で
    // 軽バンとほぼ同寸・原点は底面中心（テクスチャ埋め込み済み）。
    const addTruckModel = () => {
      if (map.getLayer("truck-3d")) return;
      map.addModel("truck", "/models/truck.glb");
      map.addSource("truck-src", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: DEMO_VEHICLES.map((v) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: v.lngLat },
            properties: { rotation: [0, 0, v.rot] },
          })),
        },
      });
      map.addLayer({
        id: "truck-3d",
        type: "model",
        source: "truck-src",
        layout: { "model-id": "truck" },
        paint: {
          "model-rotation": ["get", "rotation"], // 駐車の向き（feature ごと）
          // 夜のライティングでも沈まないよう自己発光させる（マーカーと同じ扱い）。
          "model-emissive-strength": 1,
        },
      });
      updateTruckScale();
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

    // 各デモ車両の頭上にプレート吹き出し。見かけサイズはズーム非依存。
    const plateRoots: Root[] = [];
    const plateMarkers: mapboxgl.Marker[] = [];
    for (const v of DEMO_VEHICLES) {
      const node = document.createElement("div");
      node.className = "vehicle-label"; // globals.css で吹き出し⇔ドットを切替
      node.style.zIndex = "5"; // 拠点ピンより前面
      const root = createRoot(node);
      root.render(
        <VehicleLabel
          vehicle={
            {
              number_prefix: v.plate.prefix,
              number_class: v.plate.cls,
              number_hiragana: v.plate.kana,
              number_numeric: v.plate.num,
            } as VehiclePlateData
          }
          status={v.status}
        />,
      );
      plateRoots.push(root);
      plateMarkers.push(
        new mapboxgl.Marker({ element: node, anchor: "bottom", offset: [0, -30] })
          .setLngLat(v.lngLat)
          .addTo(map),
      );
    }
    vehicleLabelMarkersRef.current = plateMarkers;

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
      plateMarkers.forEach((m) => m.remove());
      vehicleLabelMarkersRef.current = [];
      setTimeout(() => plateRoots.forEach((r) => r.unmount()), 0);
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

      const marker = new mapboxgl.Marker({ element: node })
        .setLngLat([place.lng, place.lat])
        .setPopup(popup)
        .addTo(map);
      placeMarkersRef.current.set(place.id, marker);
    }
    applyPlacesVisibilityRef.current();
  }, [places]);

  // ピン追加の位置プレビュー（名称入力中に仮ピンを立てる）。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !draft) return;
    const m = new mapboxgl.Marker({ color: "#7c3aed" })
      .setLngLat([draft.lng, draft.lat])
      .addTo(map);
    return () => {
      m.remove();
    };
  }, [draft]);

  /** 位置を1件記録して一覧を更新する。ドラッグ・クリック配置の共通処理。 */
  const savePosition = useCallback(
    async (vehicle: MapVehicle, lat: number, lng: number) => {
      setPlacingMessage(`${plateText(vehicle)} の位置を保存しています…`);
      try {
        await apiFetch("/api/admin/map/positions", {
          method: "POST",
          body: JSON.stringify({ vehicleId: vehicle.id, lat, lng }),
        });
        setPlacingMessage(`${plateText(vehicle)} の位置を記録しました`);
        await mutate();
        setTimeout(() => setPlacingMessage(null), 2500);
        return true;
      } catch (e) {
        console.error(e);
        setPlacingMessage("位置を保存できませんでした");
        setTimeout(() => setPlacingMessage(null), 4000);
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
      // 修正中は既定マーカーではなく**大きな丸いつまみ**にする。
      // 既定マーカーに filter を足すだけでは掴める場所が分からず、地図のパンと取り合いになる
      //（「どの車も光らない」「ドラッグすると地図が動く」という実機フィードバック・2026-08-06）。
      const handle = document.createElement("div");
      if (editable) {
        handle.className = "map-drag-handle";
        handle.title = "つまんで動かす";
        handle.textContent = plateShort(v);
      }
      const marker = new mapboxgl.Marker(
        editable
          ? { element: handle, draggable: true }
          : { color: p.sessionStatus === "open" ? "#059669" : "#64748b" },
      )
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
      marker.getElement().style.zIndex = editable ? "5" : "2"; // 修正中は最前面に
      if (editable) {
        marker.getElement().style.cursor = "grab";
        marker.on("dragend", () => {
          const { lng, lat } = marker.getLngLat();
          void savePosition(v, lat, lng).then((ok: boolean) => {
            if (!ok) marker.setLngLat([p.lng, p.lat]); // 失敗したら元の位置へ戻す
          });
        });
      }
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

  return (
    <AdminLayout>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">地図</h1>
          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
            ベータ
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* ライブ / 履歴（Stage 0.6）。履歴は「何月何日◯時にどこにいたか」を as-of で引く */}
            <div className="flex rounded-lg bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setHistoryDate(null)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  historyDate === null ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                ライブ
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlacing(false); // 過去に置くことはできない
                  setHistoryDate((d) => d ?? todayJST());
                }}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  historyDate !== null ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                履歴
              </button>
            </div>

            {/* 位置を置く（配置モード）。ドラッグと地図移動の取り合いをなくすため明示的なモードにする */}
            {canDispatch && historyDate === null && (
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
        {placingMessage ? (
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
        {canDispatch && !historyDate && unlocated.length > 0 && (
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
        {!isLoading && located.length === 0 && (
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

        {/* 履歴のタイムライン */}
        {historyDate && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <input
              type="date"
              value={historyDate}
              max={todayJST()}
              onChange={(e) => setHistoryDate(e.target.value || todayJST())}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <span className="w-14 text-center text-sm font-bold tabular-nums text-slate-900">
              {String(Math.floor(historyMinute / 60)).padStart(2, "0")}:
              {String(historyMinute % 60).padStart(2, "0")}
            </span>
            <input
              type="range"
              min={0}
              max={1439}
              step={15}
              value={historyMinute}
              onChange={(e) => setHistoryMinute(Number(e.target.value))}
              className="h-1.5 min-w-[200px] flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
            />
            <span className="text-[11px] text-slate-400">15分刻み</span>
          </div>
        )}

        <p className="text-xs text-slate-500">
          車両の位置を表示します（出退勤打刻のGPS、または手動で配置した位置）。カメラは右ドラッグ（Ctrl+ドラッグ）、または
          Option+スクロール（縦=傾き / 横=方角）で操作できます。拠点ピンは歯車の設定から追加できます。
          <span className="ml-2 inline-flex items-center gap-1">
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
        </p>

        {!MAPBOX_TOKEN ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Mapbox のアクセストークンが未設定です。環境変数{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[12px]">
              NEXT_PUBLIC_MAPBOX_TOKEN
            </code>{" "}
            を設定してください（ローカルは apps/web/.env.local、本番は Vercel の環境変数）。
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl border border-slate-200 shadow-sm">
            <div ref={containerRef} className="h-[70vh] min-h-[420px] w-full" />

            {/* 視点の操作パネル＋設定＋共有ビュー */}
            <div className="absolute left-3 top-3 flex flex-col items-start gap-2">
              <div className="flex items-center gap-2">
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
                  onClick={() => setShareOn((v) => !v)}
                  className={`flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold shadow transition-colors ${
                    shareOn ? "bg-slate-900 text-white" : "bg-white/95 text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <FontAwesomeIcon icon={faUsers} className="h-3.5 w-3.5" />
                  {share.status === "connecting" ? "接続中..." : "共有"}
                </button>
              </div>

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

            {/* ピン追加フォーム（位置決定後） */}
            {draft && (
              <div className="absolute inset-x-3 bottom-3 mx-auto w-full max-w-sm rounded-xl bg-white p-3 shadow-lg">
                <div className="mb-2 text-xs font-bold text-slate-700">拠点を追加</div>
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

      <ConfirmDialog
        open={deleteTarget != null}
        title="拠点の削除"
        message={`「${deleteTarget?.name ?? ""}」を削除しますか?`}
        confirmLabel="削除"
        onConfirm={() => {
          if (deleteTarget) void deletePlace(deleteTarget);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </AdminLayout>
  );
}
