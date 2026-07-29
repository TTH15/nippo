"use client";

// ============================================================
// 地図（ベータ）— 車両の最終確認位置を Mapbox 上に表示する。
// 位置ソースは vehicle_sessions の打刻GPS（/api/admin/map/vehicles）。
// マーカーをタップすると吹き出しでナンバープレートを表示する。
// スタイルは Mapbox Standard（3D建物・時間帯ライティング内蔵）。
// 拠点ピンは DB 保存（map_places）。設定モーダルから追加・削除する。
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
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
  faWarehouse,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { Skeleton } from "@/lib/components/Skeleton";
import { useApi } from "@/lib/useApi";
import { apiFetch } from "@/lib/api";
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
    kind: "checkin" | "checkout";
    sessionStatus: "open" | "closed";
    driverName: string;
  } | null;
};

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
        {working
          ? `稼働中${p.driverName ? `（${p.driverName} さん）` : ""}・${formatAt(p.at)} 出勤打刻`
          : `${formatAt(p.at)} ${p.kind === "checkout" ? "退勤" : "出勤"}打刻の位置`}
      </div>
    </div>
  );
}

// 車両の頭上ラベル: 吹き出し用に最適化した簡易プレート。黒ナンバー（事業用軽貨物）
// らしく黒地に黄文字。実車プレートの再現は popup 側の VehiclePlate に任せる。
// TODO: 数字・かなは将来 SVG グリフ化する（docs/roadmap-2026-07.md 参照）。
function VehicleLabel({ vehicle, working }: { vehicle: VehiclePlateData; working: boolean }) {
  return (
    <div className="flex flex-col items-center">
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
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${working ? "bg-emerald-500" : "bg-slate-400"}`}
          />
          {working ? "稼働中" : "退勤済み"}
        </div>
      </div>
      <div className="h-0 w-0 border-x-[7px] border-t-[7px] border-x-transparent border-t-slate-950" />
    </div>
  );
}

export default function MapPage() {
  const { data, isLoading, mutate } = useApi<{ vehicles: MapVehicle[] }>(
    "/api/admin/map/vehicles",
    { refreshInterval: 60000 },
  );
  const { data: placesData, refresh: refreshPlaces } = useApi<{ places: MapPlace[] }>(
    "/api/admin/map/places",
  );
  const places = useMemo(() => placesData?.places ?? [], [placesData]);

  const located = useMemo(
    () => (data?.vehicles ?? []).filter((v) => v.position != null),
    [data],
  );
  const unlocatedCount = (data?.vehicles?.length ?? 0) - located.length;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
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

  // ピン追加フロー: adding=クリック待ち → draft=位置決定・名称入力中。
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState<PlaceIcon>("pin");
  const [draftError, setDraftError] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MapPlace | null>(null);

  // 拠点ピンの実際の表示 = 手動トグル AND ズームによる役割分担。
  // 引き（〜14.5未満）では拠点が主役、寄ったら拠点をフェードアウトして
  // 車両モデル＋プレートに主役を譲る。
  const applyPlacesVisibility = () => {
    const zoomedOut = (mapRef.current?.getZoom() ?? 0) < 14.5;
    const visible = showPlacesRef.current && zoomedOut;
    placeMarkersRef.current.forEach((m) => {
      const el = m.getElement();
      // opacity は使わない（mapbox が3D遮蔽判定で毎フレーム上書きし、ズームで
      // 非表示が巻き戻るバグになる）。mapbox が触らない visibility で制御する。
      el.style.visibility = visible ? "" : "hidden";
      el.style.pointerEvents = visible ? "" : "none";
      // 吹き出しはズーム連動では閉じない（flyToPlace の行き先表示に使うため）。
      // 手動トグルで隠したときだけ閉じる。
      if (!showPlacesRef.current && (m.getPopup()?.isOpen() ?? false)) m.togglePopup();
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
      // Standard スタイル: ズーム14.5前後から建物が3Dで立ち上がる。
      style: "mapbox://styles/mapbox/standard",
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

    // 運営画面の地図としては基図の情報量を絞る: POI（施設名）・道路名・交通機関の
    // ラベルを非表示。地名（市区町名）だけ方向感のために残す。
    const applyBaseConfig = () => {
      map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
      map.setConfigProperty("basemap", "showRoadLabels", false);
      map.setConfigProperty("basemap", "showTransitLabels", false);
    };
    map.on("style.load", applyBaseConfig);

    // 3Dモデルの実験: サンパルク駐車場の脇にトラックを1台置く。
    // モデルは Khronos glTF サンプルの Cesium Milk Truck（CC-BY 4.0 / © Cesium）。
    // 本採用時は public/models/truck.glb を実車系モデルに差し替える。
    const addTruckModel = () => {
      if (map.getLayer("truck-3d")) return;
      map.addModel("truck", "/models/truck.glb");
      map.addSource("truck-src", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Point", coordinates: [135.7595725, 34.945416] },
          properties: {},
        },
      });
      map.addLayer({
        id: "truck-3d",
        type: "model",
        source: "truck-src",
        layout: { "model-id": "truck" },
        paint: {
          "model-rotation": [0, 0, 35], // 駐車の向きっぽく少し振る
          // 夜のライティングでも沈まないよう自己発光させる（マーカーと同じ扱い）。
          "model-emissive-strength": 1,
        },
      });
      updateTruckScale();
    };
    // 画面上の見かけサイズをズームに依らずほぼ一定に保つ（ズーム18で実寸の1.6倍、
    // 1段引くごとに実寸を2倍）。ズーム10より引いたら拡大を打ち切る。
    const updateTruckScale = () => {
      if (!map.getLayer("truck-3d")) return;
      const s = 1.6 * Math.pow(2, 18 - Math.max(map.getZoom(), 10));
      map.setPaintProperty("truck-3d", "model-scale", [s, s, s]);
    };
    map.on("style.load", addTruckModel);
    map.on("zoom", updateTruckScale);
    map.on("zoom", () => applyPlacesVisibilityRef.current());

    // トラックの頭上にプレート吹き出し（デモ値）。見かけサイズはズーム非依存。
    const plateNode = document.createElement("div");
    plateNode.style.zIndex = "5"; // 拠点ピンより前面

    const plateRoot = createRoot(plateNode);
    plateRoot.render(
      <VehicleLabel
        vehicle={
          {
            number_prefix: "京都",
            number_class: "400",
            number_hiragana: "あ",
            number_numeric: "1234",
          } as VehiclePlateData
        }
        working
      />,
    );
    const plateMarker = new mapboxgl.Marker({
      element: plateNode,
      anchor: "bottom",
      offset: [0, -46],
    })
      .setLngLat([135.7595725, 34.945416])
      .addTo(map);
    vehicleLabelMarkersRef.current = [plateMarker];

    // プレート吹き出しの重なり回避: 画面座標で衝突する場合は後のものを上へ積む。
    // （現状は1台だが、複数台化したときにそのまま効く）
    const declutterPlates = () => {
      const placed: { x: number; y: number }[] = [];
      for (const m of vehicleLabelMarkersRef.current) {
        const pos = map.project(m.getLngLat());
        let lift = 0;
        while (
          placed.some((p) => Math.abs(p.x - pos.x) < 104 && Math.abs(p.y - (pos.y - lift)) < 84)
        ) {
          lift += 88;
        }
        m.setOffset([0, -46 - lift]);
        placed.push({ x: pos.x, y: pos.y - lift });
      }
    };
    map.on("moveend", declutterPlates);

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
      plateMarker.remove();
      setTimeout(() => plateRoot.unmount(), 0);
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
      const marker = new mapboxgl.Marker({
        color: p.sessionStatus === "open" ? "#059669" : "#64748b",
      })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
      marker.getElement().style.zIndex = "2"; // 拠点ピンより前・プレート吹き出しより後
      markersRef.current.push(marker);
      bounds.extend([p.lng, p.lat]);
    }

    if (!fittedRef.current) {
      fittedRef.current = true;
      map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
    }
  }, [located]);

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
          <button
            type="button"
            onClick={() => void mutate()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <FontAwesomeIcon icon={faRotateRight} className="h-3 w-3" />
            更新
          </button>
        </div>

        <p className="text-xs text-slate-500">
          車両の最終確認位置（出退勤打刻のGPS）を表示します。カメラは右ドラッグ（Ctrl+ドラッグ）、または
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

            {/* 視点の操作パネル＋設定 */}
            <div className="absolute left-3 top-3 flex items-center gap-2">
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
            {data && located.length === 0 && !adding && (
              <div className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-white/95 px-4 py-1.5 text-xs font-medium text-slate-600 shadow">
                位置情報のある車両がまだありません（出退勤打刻のGPSが位置ソースです）
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

            <div className="space-y-4 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-700">拠点ピンを表示</div>
                  <div className="text-[11px] text-slate-400">
                    引きのズームでのみ表示（寄ると車両を優先して自動で隠れます）
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showPlaces}
                  onClick={() => setShowPlaces((v) => !v)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    showPlaces ? "bg-violet-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      showPlaces ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>

              <div>
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
