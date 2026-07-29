"use client";

// ============================================================
// 地図（ベータ）— 車両の最終確認位置を Mapbox 上に表示する。
// 位置ソースは vehicle_sessions の打刻GPS（/api/admin/map/vehicles）。
// マーカーをタップすると吹き出しでナンバープレートを表示する。
// ============================================================

import { useEffect, useMemo, useRef } from "react";
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
  const fittedRef = useRef(false);

  // 地図の初期化（トークンがある時のみ）。
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [135.76, 35.01], // 位置データが無い間のフォールバック（近畿圏）
      zoom: 8,
      language: "ja",
      // 帰属表示は規約上必須のため消せない。ⓘ アイコンへ畳むコンパクト表示は
      // 公式に許可されているのでそれを使う（ロゴは表示のまま）。
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
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
          車両の最終確認位置（出退勤打刻のGPS）を表示します。マーカーをタップするとナンバープレートが確認できます。
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
