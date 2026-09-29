import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import mapboxgl from "mapbox-gl";
import { faCrosshairs } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { previewParkingPlace } from "../../apps/mobile/ui-preview/parking-place";
import { previewVehicle } from "../../apps/mobile/ui-preview/vehicle";
import { VehiclePlate } from "../../apps/mobile/src/components/VehiclePlate";
import homeMap from "../../apps/mobile/ui-preview/home-map.png";
import mapVehicle from "../../apps/mobile/ui-preview/scene/assets/map-vehicle.png";

const parkingPoint: [number, number] = [previewParkingPlace.longitude, previewParkingPlace.latitude];
const center: [number, number] = [previewParkingPlace.longitude, previewParkingPlace.latitude + .0003];
const zoom = 16.4;

export function ParkingMapSurface({ enabled }: { enabled: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mode, setMode] = useState<"loading" | "interactive" | "static">("loading");
  const [staticFailed, setStaticFailed] = useState(false);
  const [staticLoaded, setStaticLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !container.current) return;
    let cancelled = false;
    let map: mapboxgl.Map | null = null;
    let plateRoot: Root | null = null;
    fetch("/__preview_map_config").then(response => response.json()).then(({ token }: { token: string | null }) => {
      if (cancelled) return;
      if (!token?.startsWith("pk.")) { setMode("static"); return; }
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: container.current!, style: "mapbox://styles/mapbox/streets-v12", center, zoom,
        language: "ja", dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
      mapRef.current = map;
      const marker = document.createElement("div");
      marker.style.cssText = "display:flex;flex-direction:column;align-items:center;cursor:pointer";
      const bubble = document.createElement("span");
      bubble.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;background:#fff;border-radius:11px;padding:7px 11px;box-shadow:0 2px 8px #19233333;color:#192333;white-space:nowrap";
      const plateMount = document.createElement("span");
      plateRoot = createRoot(plateMount);
      plateRoot.render(<VehiclePlate vehicle={previewVehicle} width={94} />);
      const placeLine = document.createElement("span");
      placeLine.textContent = previewParkingPlace.name;
      placeLine.style.cssText = "font-size:11px;font-weight:600";
      const parked = document.createElement("small");
      parked.textContent = " に駐車中";
      parked.style.cssText = "color:#526074;font-size:10px;font-weight:400";
      placeLine.append(parked);
      bubble.append(plateMount, placeLine);
      const tail = document.createElement("span");
      tail.style.cssText = "width:8px;height:8px;background:#fff;transform:rotate(45deg);margin-top:-4px;margin-bottom:-1px";
      const vehicle = document.createElement("img");
      vehicle.src = mapVehicle;
      vehicle.alt = "";
      vehicle.style.cssText = "display:block;width:76px;height:51px;object-fit:contain";
      marker.append(bubble, tail, vehicle);
      marker.setAttribute("aria-label", `${previewVehicle.number_prefix} ${previewVehicle.number_class} ${previewVehicle.number_hiragana} ${previewVehicle.number_numeric}、${previewParkingPlace.name}に駐車中`);
      new mapboxgl.Marker({ element: marker, anchor: "bottom" }).setLngLat(parkingPoint).addTo(map);
      map.on("load", () => { if (!cancelled) { map?.setLanguage("ja"); setMode("interactive"); map?.resize(); } });
      map.on("error", () => { if (!cancelled && !map?.loaded()) setMode("static"); });
    }).catch(() => { if (!cancelled) setMode("static"); });
    return () => { cancelled = true; mapRef.current = null; plateRoot?.unmount(); map?.remove(); };
  }, [enabled]);

  if (!enabled) return <div style={{ width: "100%", height: "100%", background: "#E8ECF0" }} />;
  return <div role="region" aria-label="駐車場所の周辺地図" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
    <div ref={container} style={{ position: "absolute", inset: 0 }} />
    {mode !== "interactive" && <img src={mode === "static" && !staticFailed ? "/__preview_parking_map" : homeMap} alt="" onLoad={() => { if (mode === "static" && !staticFailed) setStaticLoaded(true); }} onError={() => setStaticFailed(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
    {mode !== "interactive" && <div style={{ position: "absolute", left: "50%", top: "70%", display: "flex", flexDirection: "column", alignItems: "center", transform: "translate(-50%, -98%)", pointerEvents: "none" }}><span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "white", borderRadius: 11, padding: "7px 11px", boxShadow: "0 2px 8px #19233333", color: "#192333", whiteSpace: "nowrap" }}><VehiclePlate vehicle={previewVehicle} width={94} /><span style={{ fontSize: 11, fontWeight: 600 }}>{previewParkingPlace.name}<small style={{ color: "#526074", fontSize: 10, fontWeight: 400 }}> に駐車中</small></span></span><span style={{ width: 8, height: 8, background: "white", transform: "rotate(45deg)", marginTop: -4, marginBottom: -1 }} /><img src={mapVehicle} alt="" style={{ width: 76, height: 51, objectFit: "contain" }} /></div>}
    {mode === "interactive" && <button aria-label="駐車場所を地図の中心へ戻す" onClick={() => mapRef.current?.flyTo({ center, zoom, duration: 300 })} style={{ position: "absolute", top: 8, right: 8, width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "50%", background: "#FFFFFFEE", color: "#355779" }}><FontAwesomeIcon icon={faCrosshairs} style={{ width: 16 }} /></button>}
    {mode === "static" && staticLoaded && !staticFailed && <span style={{ position: "absolute", bottom: 4, right: 4, borderRadius: 5, background: "#FFFFFFE8", padding: "2px 5px", color: "#415166", fontSize: 10, lineHeight: 1.3 }}><a href="https://www.mapbox.com/about/maps" target="_blank" rel="noopener noreferrer">© Mapbox</a>　<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>　<a href="https://apps.mapbox.com/feedback/#/135.783184/35.013764/16.4" target="_blank" rel="noopener noreferrer">Improve this map</a></span>}
  </div>;
}
