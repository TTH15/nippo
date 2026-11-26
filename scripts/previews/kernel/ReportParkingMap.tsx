import { useEffect } from "react";
import type { ParkingMapProps } from "../../../apps/web/src/lib/map/ReportParkingMap";
import { useParkingLongPress } from "../../../apps/web/src/lib/map/useParkingLongPress";
export default function ReportParkingMap({ center, currentFix, pin, onPin, places, onPlace, selectedPlaceId, onStatus }: ParkingMapProps) {
  const unavailable = new URL(location.href).searchParams.get("scenario") === "parking-map-error";
  useEffect(() => onStatus(unavailable ? "unavailable" : "ready"), [unavailable, onStatus]);
  const point = center ?? { lat: 34.7, lng: 135.5 };
  const addPin = () => onPin({ lat: point.lat + 0.002, lng: point.lng + 0.001 });
  const hold = useParkingLongPress(addPin);
  if (unavailable)
    return <p role="status" className="absolute inset-x-4 top-20 rounded-xl bg-slate-100 p-3">地図を表示できません。駐車場名で検索できます。</p>;
  return <div aria-label="駐車場所の地図（架空）" className="absolute inset-0 overflow-hidden bg-emerald-50"
    style={{ background: "repeating-linear-gradient(42deg,#e3f2e7 0 34px,#f8fafc 34px 40px,#dbeaf1 40px 63px)" }}>
    <button type="button" className="absolute inset-0" aria-label="架空の地図。長押しでピンを置く。キーボードでは Enter キー。"
      onPointerDown={e => { if (e.isPrimary && e.button === 0) hold.start(e.pointerId, e.clientX, e.clientY); }}
      onPointerMove={e => hold.move(e.pointerId, e.clientX, e.clientY)} onPointerLeave={() => hold.finish()} onPointerCancel={() => hold.finish()} onPointerUp={() => hold.finish()}
      onContextMenu={e => { e.preventDefault(); if (e.button === 2 && !hold.finish()) addPin(); }}
      onClick={e => { if (e.detail === 0) addPin(); }} />
    {currentFix && <span role="img" aria-label="現在地" className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow" />}
    {pin && <span className="pointer-events-none absolute left-1/3 top-[30%] h-4 w-4 rounded-full bg-slate-950" />}
    <div className="absolute left-[15%] top-[40%] flex gap-2">
      {places.slice(0,2).map(place => <button key={place.id} className={`min-h-10 rounded-full px-2 text-xs shadow ${selectedPlaceId === place.id ? "bg-slate-900 text-white" : "bg-white"}`} aria-pressed={selectedPlaceId === place.id}
        type="button" aria-label={`地図で ${place.name} を選ぶ`} onClick={() => onPlace(place.id)}>{selectedPlaceId === place.id ? "✓" : "P"} {place.name}</button>)}
    </div>
  </div>;
}
