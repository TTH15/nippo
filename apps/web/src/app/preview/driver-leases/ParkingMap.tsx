"use client";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationDot } from "@fortawesome/free-solid-svg-icons";
import { PREVIEW_MAPBOX_TOKEN } from "./mapbox-config";
import { validPosition, type ParkingPosition } from "./parking-geocoding";
import { buttonClass } from "./ui";

// admin/(ops)/map/page.tsx のMap初期化・クリック配置・Markerのdragendを土台にする。
// GPS・実拠点・車両位置・本番APIは接続しない。地図はこの部品が開かれた間だけロードする。
export function ParkingMap({ position, onChange }: { position?: ParkingPosition; onChange: (position: ParkingPosition) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const positionRef = useRef(position);
  const changeRef = useRef(onChange);
  positionRef.current = position; changeRef.current = onChange;
  const [markerNode, setMarkerNode] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    setReady(false); setError("");
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({ container: host.current, accessToken: PREVIEW_MAPBOX_TOKEN, style: "mapbox://styles/mapbox/streets-v12", center: positionRef.current ? [positionRef.current.lng, positionRef.current.lat] : [135.5, 34.75], zoom: positionRef.current ? 16 : 10, language: "ja", attributionControl: false });
    } catch {
      setError("地図を表示できません。ブラウザのWebGL設定を確認してください。"); return;
    }
    mapRef.current = map;
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.getCanvas().setAttribute("aria-label", "駐車場所の地図");
    map.getCanvas().style.cursor = "crosshair";
    map.on("load", () => { setReady(true); setError(""); });
    map.on("error", () => setError("地図を読み込めません。通信状態・Mapboxの公開トークンとURL制限を確認してください。"));
    map.on("click", event => {
      const p = { lat: event.lngLat.lat, lng: event.lngLat.wrap().lng };
      if (validPosition(p)) changeRef.current(p);
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host.current);
    const timeout = setTimeout(() => { if (!map.loaded()) setError("地図の読み込みに時間がかかっています。通信状態を確認して再読み込みしてください。"); }, 15000);
    return () => { clearTimeout(timeout); observer.disconnect(); markerRef.current?.remove(); markerRef.current = null; mapRef.current = null; map.remove(); };
  }, [retry]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!position) { markerRef.current?.remove(); markerRef.current = null; setMarkerNode(null); return; }
    if (!markerRef.current) {
      const element = document.createElement("div");
      element.setAttribute("aria-label", "駐車場所のピン"); element.setAttribute("role", "img");
      element.className = "h-11 w-11 cursor-grab";
      markerRef.current = new mapboxgl.Marker({ element, draggable: true, anchor: "bottom" }).setLngLat([position.lng, position.lat]).addTo(map);
      markerRef.current.on("dragend", () => {
        const point = markerRef.current?.getLngLat().wrap();
        if (point && validPosition(point)) changeRef.current({ lat: point.lat, lng: point.lng });
      });
      setMarkerNode(element);
    } else markerRef.current.setLngLat([position.lng, position.lat]);
    map.jumpTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), 16) });
  }, [position, ready, retry]);
  return <div className="space-y-2">
    <div ref={host} className="h-60 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"/>
    {markerNode && createPortal(<FontAwesomeIcon icon={faLocationDot} style={{ width: 44, height: 44, display: "block" }} className="text-amber-600 drop-shadow-md"/>, markerNode)}
    {error ? <div role="alert" className="space-y-2 text-xs text-red-700"><p>{error}</p><button type="button" className={buttonClass} onClick={() => setRetry(value => value + 1)}>地図を再読み込み</button></div> : !ready ? <p role="status" className="text-xs text-slate-500">地図を読み込んでいます…</p> : <p className="text-[11px] leading-5 text-slate-500">地図を押すかピンをドラッグして、入口や駐車区画に合わせてください。ピン移動では住所は変わりません。</p>}
    <button type="button" className={buttonClass + " text-xs"} disabled={!ready || !!error} onClick={() => { const center = mapRef.current?.getCenter().wrap(); if (center && validPosition(center)) onChange({ lat: center.lat, lng: center.lng }); }}>地図の中心にピンを置く</button>
  </div>;
}
