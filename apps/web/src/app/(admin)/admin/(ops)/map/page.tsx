"use client";

// ============================================================
// 地図（ベータ）— 車両の最終確認位置を Mapbox 上に表示する。
// 位置ソースは vehicle_sessions の打刻GPS（/api/admin/map/vehicles）。
// マーカーをタップすると吹き出しでナンバープレートを表示する。
// スタイルは Mapbox Standard（3D建物・時間帯ライティング内蔵）。
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createRoot, type Root } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { useApi } from "@/lib/useApi";
import { VehiclePlate, type VehiclePlateData } from "@/lib/components/VehiclePlate";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Mapbox Standard の時間帯ライティング（setConfigProperty で切替）。
const LIGHT_PRESETS = [
  { key: "dawn", label: "朝" },
  { key: "day", label: "昼" },
  { key: "dusk", label: "夕" },
  { key: "night", label: "夜" },
] as const;
type LightPreset = (typeof LIGHT_PRESETS)[number]["key"];

// よく使う拠点（固定マーカー）。座標は Mapbox Geocoding v6 による（住所→番地レベル）。
// 伏見桃山駐車場のみ Mapbox 未収録のため国土地理院の住所検索（26番地）の値。
const PLACES = [
  {
    key: "amazon-hirakata",
    name: "Amazon DOO4 大阪枚方DS",
    address: "枚方市招提大谷2-10-1 枚方IIロジスティクスセンター内",
    lngLat: [135.6946917, 34.8354222] as [number, number],
  },
  {
    key: "kuruma-ya",
    name: "車屋さん（らいとすたっふ）",
    address: "京都市西京区川島調子町73-19",
    lngLat: [135.6991528, 34.972] as [number, number],
  },
  {
    key: "alivio-toji",
    name: "アリビオ東寺",
    address: "京都市南区西九条南田町10-2",
    lngLat: [135.7474472, 34.9779583] as [number, number],
  },
  {
    key: "fushimi-parking",
    name: "サンパルク伏見桃山駐車場（12番）",
    address: "京都市伏見区深草善導寺町26-2",
    lngLat: [135.759155, 34.945873] as [number, number],
  },
] as const;
type PlaceKey = (typeof PLACES)[number]["key"];

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

export default function MapPage() {
  const { data, isLoading, mutate } = useApi<{ vehicles: MapVehicle[] }>(
    "/api/admin/map/vehicles",
    { refreshInterval: 60000 },
  );

  const located = useMemo(
    () => (data?.vehicles ?? []).filter((v) => v.position != null),
    [data],
  );
  const unlocatedCount = (data?.vehicles?.length ?? 0) - located.length;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRootsRef = useRef<Root[]>([]);
  const placeMarkersRef = useRef<Map<PlaceKey, mapboxgl.Marker>>(new Map());
  const fittedRef = useRef(false);
  const [is3D, setIs3D] = useState(false);
  const [light, setLight] = useState<LightPreset>("day");

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
      language: "ja",
      // 帰属表示は規約上必須のため消せない。ⓘ アイコンへ畳むコンパクト表示は
      // 公式に許可されているのでそれを使う（ロゴは表示のまま）。
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    // 拠点マーカー（紫）。車両マーカーと違い固定なので初期化時に一度だけ貼る。
    for (const place of PLACES) {
      const popup = new mapboxgl.Popup({ offset: 28, maxWidth: "260px" }).setHTML(
        `<div style="padding:4px;font-size:12px;line-height:1.5">` +
          `<div style="font-weight:700">${place.name}</div>` +
          `<div style="color:#64748b;font-size:11px">${place.address}</div>` +
          `</div>`,
      );
      const marker = new mapboxgl.Marker({ color: "#7c3aed" })
        .setLngLat(place.lngLat)
        .setPopup(popup)
        .addTo(map);
      placeMarkersRef.current.set(place.key, marker);
    }
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      placeMarkersRef.current.forEach((m) => m.remove());
      placeMarkersRef.current.clear();
      const roots = popupRootsRef.current;
      popupRootsRef.current = [];
      setTimeout(() => roots.forEach((r) => r.unmount()), 0);
      map.remove();
      mapRef.current = null;
    };
  }, []);

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

      const popup = new mapboxgl.Popup({ offset: 28, maxWidth: "240px" }).setDOMContent(node);
      const marker = new mapboxgl.Marker({
        color: p.sessionStatus === "open" ? "#059669" : "#64748b",
      })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([p.lng, p.lat]);
    }

    if (!fittedRef.current) {
      fittedRef.current = true;
      map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
    }
  }, [located]);

  // カメラを傾けて3D視点へ（戻す時は真上から）。
  const toggle3D = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !is3D;
    setIs3D(next);
    map.easeTo(
      next
        ? { pitch: 62, bearing: -18, duration: 1400 }
        : { pitch: 0, bearing: 0, duration: 900 },
    );
  };

  const changeLight = (preset: LightPreset) => {
    setLight(preset);
    mapRef.current?.setConfigProperty("basemap", "lightPreset", preset);
  };

  // 拠点を選択 → その場所へフライト＆吹き出しを開く（ピッチ・方位は現状維持）。
  const flyToPlace = (key: PlaceKey) => {
    const map = mapRef.current;
    const place = PLACES.find((p) => p.key === key);
    if (!map || !place) return;
    map.flyTo({ center: place.lngLat, zoom: 16.5, duration: 2200 });
    placeMarkersRef.current.forEach((marker, k) => {
      const open = marker.getPopup()?.isOpen() ?? false;
      if (k === key ? !open : open) marker.togglePopup();
    });
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
          車両の最終確認位置（出退勤打刻のGPS）を表示します。マーカーをタップするとナンバープレートが確認できます。右ドラッグ（Ctrl+ドラッグ / 2本指）でカメラの回転・傾きを操作できます。
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
            {/* 視点・ライティングの操作パネル */}
            <div className="absolute left-3 top-3 flex flex-col items-start gap-2">
              <button
                type="button"
                onClick={toggle3D}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold shadow transition-colors ${
                  is3D
                    ? "bg-slate-900 text-white"
                    : "bg-white/95 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {is3D ? "2D に戻す" : "3D で見る"}
              </button>
              <div className="flex overflow-hidden rounded-lg bg-white/95 shadow">
                {LIGHT_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => changeLight(p.key)}
                    className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      light === p.key
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* 拠点セレクタ: 押すとその場所へフライトして吹き出しを開く */}
              <div className="flex flex-col overflow-hidden rounded-lg bg-white/95 shadow">
                <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-bold text-violet-600">
                  拠点
                </div>
                {PLACES.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => flyToPlace(p.key)}
                    className="px-2.5 py-1.5 text-left text-xs font-semibold text-slate-600 transition-colors hover:bg-violet-50 hover:text-violet-700"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            {isLoading && !data && (
              <div className="absolute inset-0 bg-white/60 p-4">
                <Skeleton className="h-full w-full rounded-lg" />
              </div>
            )}
            {data && located.length === 0 && (
              <div className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-white/95 px-4 py-1.5 text-xs font-medium text-slate-600 shadow">
                位置情報のある車両がまだありません（出退勤打刻のGPSが位置ソースです）
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
