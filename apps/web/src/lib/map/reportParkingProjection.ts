import type { MapPoint } from "./reportParkingLocation";

const MAX_LAT = 85.0511;

function mercator(point: MapPoint, zoom: number) {
  const size = 512 * 2 ** zoom;
  const sinLat = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, point.lat)) * Math.PI / 180);
  return { x: size * (point.lng + 180) / 360, y: size * (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)), size };
}
export function mapImageOffset(point: MapPoint, center: MapPoint, zoom: number) {
  const a = mercator(point, zoom), b = mercator(center, zoom);
  return { x: (a.x - b.x + 1.5 * a.size) % a.size - a.size / 2, y: a.y - b.y };
}
export function mapImagePoint(center: MapPoint, zoom: number, dx: number, dy: number): MapPoint {
  const p = mercator(center, zoom);
  const lng = (((p.x + dx) / p.size % 1 + 1) % 1) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(1, (p.y + dy) / p.size))))) * 180 / Math.PI;
  return { lng, lat };
}

/** Request an area centered on the provider projection grid, not the device fix. */
export function mapImageAreaCenter(point: MapPoint, zoom: number): MapPoint {
  const { x, y } = mercator(point, zoom);
  const grid = 192;
  return mapImagePoint(point, zoom, Math.round(x / grid) * grid - x, Math.round(y / grid) * grid - y);
}
