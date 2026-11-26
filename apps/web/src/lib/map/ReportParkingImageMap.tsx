"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParkingMapProps } from "./ReportParkingMap";
import { type MapPoint, validParkingPoint } from "./reportParkingLocation";
import { mapImageAreaCenter, mapImageOffset, mapImagePoint } from "./reportParkingProjection";
import { useParkingImageGestures, type ParkingCamera as Camera } from "./useParkingImageGestures";
import { ParkingRecenterButton } from "./ParkingRecenterButton";

const control = "grid h-11 w-11 place-items-center border-b border-slate-200 bg-white text-lg text-slate-900 last:border-0 disabled:text-slate-400";
type ImageFrame = Camera & { width: number; height: number; scale: number; area: MapPoint; url: string };

export default function ReportParkingImageMap({ center, currentFix, defaultCenter, places, pin, selectedPlaceId, onPin, onPlace, onStatus, token, onRetry }: ParkingMapProps & {
  defaultCenter: MapPoint;
  token: string;
  onRetry: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapLayer = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>(() => ({ center: center ?? defaultCenter, zoom: center ? 16 : 10 }));
  const [settled, setSettled] = useState(camera);
  const [size, setSize] = useState({ width: 0, height: 0, scale: 1 });
  const [visible, setPresented] = useState<ImageFrame | null>(null);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    if (center) setCamera({ center, zoom: 16 });
  }, [center]);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(camera), 120);
    return () => clearTimeout(timer);
  }, [camera]);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    function measure() {
      setSize(prev => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return prev;
        const scale = Math.max(prev.scale, Math.ceil(Math.max(w, h) / 1024));
        // Buffer camera/grid offsets, browser toolbar motion and ordinary viewport resizing.
        const width = Math.min(1280, Math.max(prev.width, Math.ceil((w / scale + 224) / 256) * 256));
        const height = Math.min(1280, Math.max(prev.height, Math.ceil((h / scale + 224) / 256) * 256));
        return prev.width === width && prev.height === height && prev.scale === scale ? prev : { width, height, scale };
      });
    }
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const request = useMemo<ImageFrame | null>(() => {
    if (!size.width || !size.height) return null;
    if (host.current && visible?.zoom === settled.zoom && visible.scale === size.scale) {
      const offset = mapImageOffset(settled.center, visible.area, settled.zoom);
      const fitsWidth = 2 * Math.abs(offset.x) + host.current.clientWidth / visible.scale <= visible.width;
      const fitsHeight = 2 * Math.abs(offset.y) + host.current.clientHeight / visible.scale <= visible.height;
      if (fitsWidth && fitsHeight && visible.width === size.width && visible.height === size.height) return visible;
    }
    const area = mapImageAreaCenter(settled.center, settled.zoom);
    const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${area.lng.toFixed(7)},${area.lat.toFixed(7)},${settled.zoom}/${size.width}x${size.height}@2x?logo=false&attribution=false&access_token=${encodeURIComponent(token)}`;
    return { ...settled, ...size, area, url };
  }, [settled, size, token, visible]);
  const pending = request && visible?.url !== request.url ? request : null;
  const error = !!request && failed === request.url;
  useEffect(() => { onStatus(visible ? "ready" : error ? "unavailable" : "loading"); }, [error, onStatus, visible]);
  useEffect(() => {
    if (!pending || error) return;
    const timer = setTimeout(() => setFailed(pending.url), 10_000);
    return () => clearTimeout(timer);
  }, [pending, error]);

  const pinAt = (x: number, y: number) => {
    const rect = host.current?.getBoundingClientRect();
    if (rect && visible) onPin(mapImagePoint(camera.center, camera.zoom, (x - rect.left - rect.width / 2) / visible.scale, (y - rect.top - rect.height / 2) / visible.scale));
  };
  const gestures = useParkingImageGestures(camera, visible?.scale ?? 1, mapLayer, setCamera, pinAt);
  const placeOnImage = (p: MapPoint) => {
    if (!visible) return null;
    const offset = mapImageOffset(p, camera.center, camera.zoom);
    if (Math.abs(offset.x) > visible.width / 2 || Math.abs(offset.y) > visible.height / 2) return null;
    const x = offset.x * visible.scale, y = offset.y * visible.scale;
    return { left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` };
  };
  const pointStyle = pin && placeOnImage(pin);
  const fixStyle = currentFix && placeOnImage(currentFix);
  const zoom = (amount: number) => setCamera(f => ({ ...f, zoom: Math.max(4, Math.min(20, f.zoom + amount)) }));
  const shift = (x: number, y: number) => setCamera(f => ({ ...f, center: mapImagePoint(f.center, camera.zoom, x / (visible?.scale ?? 1), y / (visible?.scale ?? 1)) }));
  const images = visible ? [visible, ...(pending ? [pending] : [])] : pending ? [pending] : [];
  return <div ref={host} data-testid="parking-image-map" className="absolute inset-0 touch-none overflow-hidden bg-slate-100">
    <div className="absolute inset-0 touch-none" {...gestures}>
    {visible && <button type="button" className="absolute inset-0 cursor-grab outline-offset-[-3px] active:cursor-grabbing" aria-label="駐車場所の地図。長押しでピンを置く。キーボードでは Enter キー。"
        onKeyDown={e => {
          const off = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }[e.key];
          if (off) { e.preventDefault(); shift(off[0], off[1]); }
        }}
        onClick={e => { if (e.detail === 0) onPin(camera.center); }} />}
    <div ref={mapLayer} className="pointer-events-none absolute inset-0">
      {images.map(frame => {
        const shown = frame.url === visible?.url;
        const offset = mapImageOffset(camera.center, frame.area, camera.zoom);
        const imageScale = frame.scale * 2 ** (camera.zoom - frame.zoom);
        return (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={frame.url} src={frame.url} alt={shown ? "駐車場所の地図" : ""} draggable={false}
            onLoad={() => { if (pending?.url === frame.url) { setPresented(frame); setFailed(""); } }} onError={() => { if (pending?.url === frame.url) setFailed(frame.url); }}
            className={`pointer-events-none absolute max-w-none -translate-x-1/2 -translate-y-1/2 ${shown ? "" : "invisible"}`}
            style={{ left: `calc(50% + ${-offset.x * frame.scale}px)`, top: `calc(50% + ${-offset.y * frame.scale}px)`,
              width: frame.width * imageScale, height: frame.height * imageScale }}
            width={frame.width * frame.scale} height={frame.height * frame.scale} />
        );
      })}
      {visible && <>
        {fixStyle && <span role="img" aria-label="現在地" style={fixStyle} className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow" />}
        {places.filter(validParkingPoint).map(place => {
          const position = placeOnImage(place);
          const selected = place.id === selectedPlaceId;
          return position && <button key={place.id} data-parking-marker type="button" style={position} aria-label={`地図で ${place.name} を選ぶ`} aria-pressed={selected}
            onClick={() => onPlace(place.id)} className={`pointer-events-auto absolute min-h-10 -translate-x-1/2 -translate-y-[calc(100%+.375rem)] whitespace-nowrap rounded-full border-2 px-2.5 text-xs font-semibold shadow ${selected ? "border-slate-950 bg-slate-950 text-white" : "border-white bg-white text-slate-900"}`}>{selected ? "✓" : "P"} {place.name}</button>;
        })}
        {pointStyle && <span aria-hidden="true" style={pointStyle} className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-950 shadow" />}
      </>}
    </div>
    </div>
    {visible && <>
      {currentFix && <ParkingRecenterButton onClick={() => setCamera({ center: currentFix, zoom: 16 })} />}
      <div className="absolute right-3 top-12 overflow-hidden rounded-lg shadow">
        <button type="button" aria-label="拡大" className={control} disabled={camera.zoom >= 20} onClick={() => zoom(1)}>+</button>
        <button type="button" aria-label="縮小" className={control} disabled={camera.zoom <= 4} onClick={() => zoom(-1)}>−</button>
      </div>
      <div className="absolute right-2 top-1.5 flex max-w-[52%] flex-wrap items-center gap-x-1.5 rounded bg-white/80 px-1 text-[10px] text-slate-700">
        <a className="mapboxgl-ctrl-logo !h-4 !w-12 !bg-contain" aria-label="Mapbox" href="https://www.mapbox.com/" target="_blank" rel="noreferrer" />
        <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">© Mapbox</a>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
        <a href={`https://apps.mapbox.com/feedback/#/${visible.area.lng}/${visible.area.lat}/${visible.zoom}`} target="_blank" rel="noreferrer">地図を改善</a>
      </div>
    </>}
    {error && <div className="absolute inset-x-3 top-3 mx-auto max-w-md rounded-xl bg-white p-3 text-sm text-slate-700 shadow" role="status">
      <p>{visible ? "地図を更新できません。" : "地図を読み込めません。"}</p>
      <button type="button" className="min-h-11 font-semibold underline" onClick={onRetry}>地図を再読み込み</button>
    </div>}
    {!visible && !error && <span className="sr-only" role="status">地図を読み込み中</span>}
  </div>;
}
