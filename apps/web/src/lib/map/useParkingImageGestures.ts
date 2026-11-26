import { useRef, type PointerEvent, type RefObject } from "react";
import type { MapPoint } from "./reportParkingLocation";
import { mapImageOffset, mapImagePoint } from "./reportParkingProjection";
import { PARKING_DRAG_SLOP, useParkingLongPress } from "./useParkingLongPress";

export type ParkingCamera = { center: MapPoint; zoom: number };
type Finger = { x: number; y: number };

export function useParkingImageGestures(camera: ParkingCamera, scale: number, layer: RefObject<HTMLDivElement | null>,
  onCamera: (next: ParkingCamera) => void, onHold: (x: number, y: number) => void) {
  const fingers = useRef(new Map<number, Finger>());
  const gesture = useRef<{
    base: ParkingCamera; live: ParkingCamera; start: Finger; distance: number;
    origin: Finger; anchor: MapPoint; moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const hold = useParkingLongPress((x, y) => { suppressClick.current = true; onHold(x, y); });

  function measure() {
    const [a, b] = fingers.current.values();
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) }
      : { ...a, distance: 0 };
  }
  function rebase(surface: HTMLElement) {
    const live = gesture.current?.live ?? camera;
    const rect = surface.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const start = measure();
    const anchor = mapImagePoint(live.center, live.zoom, (start.x - origin.x) / scale, (start.y - origin.y) / scale);
    gesture.current = { base: live, live, start, distance: start.distance, origin, anchor, moved: suppressClick.current };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || !fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hold.move(e.pointerId, e.clientX, e.clientY);
    const point = measure();
    if (!g.moved && !point.distance && Math.hypot(point.x - g.start.x, point.y - g.start.y) <= PARKING_DRAG_SLOP) return;
    g.moved = true;
    suppressClick.current = true;
    const zoom = point.distance && g.distance
      ? Math.round(Math.max(4, Math.min(20, g.base.zoom + Math.log2(point.distance / g.distance))) * 100) / 100
      : g.base.zoom;
    const center = mapImagePoint(g.anchor, zoom, (g.origin.x - point.x) / scale, (g.origin.y - point.y) / scale);
    g.live = { center, zoom };
    const offset = mapImageOffset(camera.center, center, zoom);
    if (layer.current) layer.current.style.transform = `translate3d(${offset.x * scale}px, ${offset.y * scale}px, 0) scale(${2 ** (zoom - camera.zoom)})`;
  }
  function end(e: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (!fingers.current.has(e.pointerId)) return;
    if (!cancelled) move(e);
    hold.finish();
    fingers.current.delete(e.pointerId);
    if (fingers.current.size) { rebase(e.currentTarget); return; }
    const g = gesture.current;
    if (g?.moved) onCamera(g.live);
    gesture.current = null;
    if (layer.current) layer.current.style.transform = "";
  }
  return {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0 || fingers.current.size >= 2) return;
      const target = e.target as HTMLElement;
      if (!fingers.current.size) {
        suppressClick.current = false;
        if (!target.closest("[data-parking-marker]")) hold.start(e.pointerId, e.clientX, e.clientY);
      } else {
        hold.finish();
        suppressClick.current = true;
      }
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      target.setPointerCapture(e.pointerId);
      rebase(e.currentTarget);
    },
    onPointerMove: move,
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => end(e, false),
    onPointerCancel: (e: PointerEvent<HTMLDivElement>) => end(e, true),
    onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) => end(e, true),
    onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
      if (suppressClick.current && e.detail) { e.preventDefault(); e.stopPropagation(); }
    },
    onContextMenu(e: React.MouseEvent<HTMLDivElement>) {
      e.preventDefault();
      if (e.button === 2 && !hold.finish() && !(e.target as HTMLElement).closest("[data-parking-marker]")) onHold(e.clientX, e.clientY);
    },
  };
}
