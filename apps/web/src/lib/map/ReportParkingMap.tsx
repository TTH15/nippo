"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { ParkingPlaceOption } from "@repo/core/types";
import { validParkingPoint, type MapPoint } from "./reportParkingLocation";
import { ParkingRecenterButton } from "./ParkingRecenterButton";
import ReportParkingImageMap from "./ReportParkingImageMap";
import { useParkingLongPress } from "./useParkingLongPress";

export type ParkingMapProps = {
  center: MapPoint | null; currentFix: MapPoint | null; pin: MapPoint | null; places: ParkingPlaceOption[]; selectedPlaceId: string | null;
  onPin: (point: MapPoint) => void; onPlace: (placeId: string) => void;
  onStatus: (state: "loading" | "ready" | "unavailable") => void;
};
const DEFAULT_CENTER: MapPoint = { lat: 35.03, lng: 135.76 };
const ll = (p: MapPoint): [number, number] => [p.lng, Math.max(-85, Math.min(p.lat, 85))];

export default function ReportParkingMap(props: ParkingMapProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const host = useRef<HTMLDivElement>(null);
  const recordedMap = useRef<MapboxMap | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const currentDot = useRef<Marker | null>(null);
  const placeButtons = useRef(new Map<string, HTMLButtonElement>());
  const [sdk, setSdk] = useState<typeof import("mapbox-gl").default | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<"data" | "access" | "webgl" | null>(null);
  const [retry, setRetry] = useState(0);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const previewImage = process.env.NEXT_PUBLIC_PREVIEW_MAPBOX_ENABLED === "true" && typeof window !== "undefined" &&
    new URLSearchParams(location.search).get("map") === "image";
  const imageFallback = !!token && (!!failure || previewImage);
  const center = props.center;
  const lastFix = props.currentFix;
  const hitTest = (x: number, y: number) => {
    const rect = host.current?.getBoundingClientRect();
    if (!rect || !recordedMap.current) return;
    const point = recordedMap.current.unproject([x - rect.left, y - rect.top]).wrap();
    const p = { lat: point.lat, lng: point.lng };
    if (validParkingPoint(p)) callbacks.current.onPin(p);
  };
  const hold = useParkingLongPress(hitTest);
  useEffect(() => {
    if (!imageFallback) props.onStatus(failure ? "unavailable" : ready ? "ready" : "loading");
  }, [failure, imageFallback, props.onStatus, ready]);

  useEffect(() => {
    let active = true;
    let map: MapboxMap | null = null;
    let observer: ResizeObserver | null = null;
    let painted = false;
    setReady(false); setFailure(null);
    const diagnose = (reason: string) => {
      // Local preview diagnostics contain a category only, never the token, URL or coordinates.
      if (["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) console.info("[parking-map]", reason);
    };
    if (previewImage) return;
    if (!token) { diagnose("public-map-config-missing"); setFailure("access"); return; }
    // Include SDK load time; don't fail an already drawn map because an optional tile is still loading.
    const deadline = setTimeout(() => {
      if (active && !painted) {
        diagnose("initial-draw-timeout");
        setFailure(current => current ?? "data");
      }
    }, 7000);
    const markReady = () => {
      if (!active || painted) return;
      painted = true;
      clearTimeout(deadline);
      setReady(true);
      setFailure(null);
    };
    void import("mapbox-gl").then(({ default: lib }) => {
      if (!active || !host.current) return;
      if (!lib.supported()) { clearTimeout(deadline); diagnose("webgl-unsupported"); setFailure("webgl"); return; }
      const start = callbacks.current.center;
      map = new lib.Map({
        container: host.current, accessToken: token, style: "mapbox://styles/mapbox/streets-v12",
        center: ll(start ?? DEFAULT_CENTER), zoom: start ? 16 : 10, language: "ja",
        dragRotate: false, pitchWithRotate: false, scrollZoom: false, attributionControl: false,
        logoPosition: "top-right",
      });
      map.touchZoomRotate.disableRotation();
      recordedMap.current = map; setSdk(lib);
      map.addControl(new lib.AttributionControl({ compact: true }), "top-right");
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      const topRightControls = host.current.querySelector<HTMLElement>(".mapboxgl-ctrl-top-right");
      if (topRightControls) {
        topRightControls.style.right = "env(safe-area-inset-right, 0px)";
      }
      map.getCanvas().setAttribute("aria-label", "駐車場所の地図");
      map.getCanvas().style.cursor = "crosshair";
      map.on("load", markReady);
      map.on("render", () => {
        if (!painted && map?.isStyleLoaded()) markReady();
      });
      map.on("error", event => {
        const status = (event.error as { status?: number } | undefined)?.status;
        if (active && !painted && (status === 401 || status === 403)) {
          clearTimeout(deadline);
          diagnose("provider-access-refused");
          setFailure("access");
        }
      });
      map.on("webglcontextlost", () => { if (active) { diagnose("webgl-context-lost"); setFailure("webgl"); } });
      map.on("webglcontextrestored", () => {
        if (!active) return;
        if (painted) setFailure(null);
        else map?.triggerRepaint();
      });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => map?.resize());
        observer.observe(host.current);
      }
    }).catch(() => { if (active) { clearTimeout(deadline); diagnose("sdk-or-map-initialization-failed"); setFailure("data"); } });
    return () => { active = false; clearTimeout(deadline); observer?.disconnect(); pinMarker.current = null; currentDot.current = null; recordedMap.current = null; map?.remove(); };
  }, [previewImage, retry, token]);

  useEffect(() => {
    const map = recordedMap.current;
    if (ready && map && center) map.jumpTo({ center: ll(center), zoom: 16 });
  }, [ready, center]);

  useEffect(() => {
    const map = recordedMap.current;
    if (!ready || !map || !sdk) return;
    const markers = props.places.filter(p => validParkingPoint(p)).map(place => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `地図で ${place.name} を選ぶ`);
      button.className = "min-h-10 whitespace-nowrap rounded-full border-2 px-2.5 text-xs font-semibold shadow focus-visible:outline-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
      button.dataset.parkingName = place.name;
      placeButtons.current.set(place.id, button);
      button.onclick = e => { e.stopPropagation(); callbacks.current.onPlace(place.id); };
      return new sdk.Marker({ element: button, anchor: "bottom", offset: [0, -7] }).setLngLat(ll(place)).addTo(map);
    });
    return () => { markers.forEach(m => m.remove()); placeButtons.current.clear(); };
  }, [ready, props.places, sdk]);

  useEffect(() => {
    for (const [id, button] of placeButtons.current) {
      const selected = id === props.selectedPlaceId;
      button.setAttribute("aria-pressed", String(selected));
      button.textContent = `${selected ? "✓" : "P"} ${button.dataset.parkingName}`;
      for (const cls of ["bg-slate-950", "border-slate-950", "text-white"]) button.classList.toggle(cls, selected);
      for (const cls of ["bg-white", "border-white", "text-slate-900"]) button.classList.toggle(cls, !selected);
      button.style.zIndex = selected ? "1" : "";
    }
  }, [ready, props.places, props.selectedPlaceId, sdk]);

  useEffect(() => {
    const map = recordedMap.current;
    if (!ready || !map || !sdk || !props.pin) { pinMarker.current?.remove(); pinMarker.current = null; return; }
    if (!pinMarker.current) pinMarker.current = new sdk.Marker({ color: "#0f172a" }).setLngLat(ll(props.pin)).addTo(map);
    else pinMarker.current.setLngLat(ll(props.pin));
  }, [ready, props.pin, sdk]);

  useEffect(() => {
    const map = recordedMap.current;
    if (!ready || !map || !sdk || !lastFix) return;
    const dot = document.createElement("div");
    dot.className = "pointer-events-none h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow";
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", "現在地");
    currentDot.current = new sdk.Marker({ element: dot }).setLngLat(ll(lastFix)).addTo(map);
    return () => { currentDot.current?.remove(); currentDot.current = null; };
  }, [ready, lastFix, sdk]);

  // Retain the same map host while the fallback runs; a late vector load can still recover.
  const vectorShown = !failure && !previewImage;
  return <div className="absolute inset-0 overflow-hidden">
    {imageFallback && token && <ReportParkingImageMap key={retry} {...props} token={token} defaultCenter={DEFAULT_CENTER} onRetry={() => setRetry(x => x + 1)} />}
    <div ref={host} data-testid="parking-map" tabIndex={vectorShown && ready ? 0 : -1}
      aria-label="駐車場所の地図。長押しでピンを置く。キーボードでは Enter キー。"
      style={{ position: "absolute", inset: 0 }}
      className={`bg-slate-100 ${vectorShown ? "" : "pointer-events-none opacity-0"}`}
      aria-hidden={!vectorShown} inert={!vectorShown}
      onPointerDown={e => {
        const canvas = (e.target as Element).matches("canvas");
        if (ready && canvas && e.isPrimary && e.button === 0) hold.start(e.pointerId, e.clientX, e.clientY);
        else hold.finish();
      }}
      onPointerMove={e => hold.move(e.pointerId, e.clientX, e.clientY)} onPointerUp={() => hold.finish()}
      onPointerCancel={() => hold.finish()} onPointerLeave={() => hold.finish()}
      onContextMenu={e => {
        if (!(e.target as Element).matches("canvas")) return;
        e.preventDefault();
        if (e.button === 2 && !hold.finish()) hitTest(e.clientX, e.clientY);
      }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        const p = recordedMap.current?.getCenter().wrap();
        if (p) props.onPin({ lat: p.lat, lng: p.lng });
      }} />
    {vectorShown && ready && lastFix && <ParkingRecenterButton onClick={() => recordedMap.current?.jumpTo({ center: ll(lastFix), zoom: 16 })} />}
    {failure && !imageFallback && <div className="absolute inset-x-3 top-3 mx-auto max-w-md rounded-xl bg-white p-3 text-sm text-slate-700 shadow" role="status">
      <p>{failure === "webgl" ? "このブラウザでは地図を表示できません。" : "地図を読み込めません。"}</p>
      <button type="button" className="min-h-11 font-semibold underline" onClick={() => setRetry(x => x + 1)}>地図を再読み込み</button>
    </div>}
    {vectorShown && !ready && <span role="status" className="sr-only">地図を読み込み中</span>}
  </div>;
}
