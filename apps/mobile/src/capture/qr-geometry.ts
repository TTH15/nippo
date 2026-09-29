export type QrPoint = { x: number; y: number };
export type QrMotionTarget = { box: { x: number; y: number; width: number; height: number; angleDeg: number }; corners: [QrPoint, QrPoint, QrPoint, QrPoint]; finders: [QrPoint, QrPoint, QrPoint] };
export const MIN_QR_SPAN = 128;

export function orientedQrBox(topLeft: QrPoint, topRight: QrPoint, bottomRight: QrPoint, bottomLeft: QrPoint) {
  const center = { x: (topLeft.x + topRight.x + bottomRight.x + bottomLeft.x) / 4, y: (topLeft.y + topRight.y + bottomRight.y + bottomLeft.y) / 4 };
  const width = (Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) + Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y)) / 2;
  const height = (Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) + Math.hypot(bottomRight.x - topRight.x, bottomRight.y - topRight.y)) / 2;
  const angleDeg = Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180 / Math.PI;
  return { x: center.x - width / 2, y: center.y - height / 2, width, height, angleDeg };
}

// Expo Camera の cornerPoints はプラットフォームごとに並び順が違う。
export function qrMotionTarget(points: QrPoint[], cameraWidth: number, cameraHeight: number): QrMotionTarget | null {
  if (points.length < 4 || cameraWidth <= 0 || cameraHeight <= 0) return null;
  const local = points.slice(0, 4).map(point => ({ x: point.x - (cameraWidth - 232) / 2, y: point.y - (cameraHeight - 232) / 2 }));
  if (local.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const x = Math.min(...local.map(point => point.x)), y = Math.min(...local.map(point => point.y));
  const width = Math.max(...local.map(point => point.x)) - x, height = Math.max(...local.map(point => point.y)) - y;
  if (x < -10 || y < -10 || x + width > 242 || y + height > 242 || width < MIN_QR_SPAN || height < MIN_QR_SPAN) return null;
  const center = { x: local.reduce((sum, point) => sum + point.x, 0) / 4, y: local.reduce((sum, point) => sum + point.y, 0) / 4 };
  const ordered = [...local].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const first = ordered.reduce((best, point, index) => point.x + point.y < ordered[best].x + ordered[best].y ? index : best, 0);
  const [topLeft, topRight, bottomRight, bottomLeft] = [...ordered.slice(first), ...ordered.slice(0, first)];
  const box = orientedQrBox(topLeft, topRight, bottomRight, bottomLeft);
  if (box.width < MIN_QR_SPAN || box.height < MIN_QR_SPAN) return null;
  const inset = .15;
  const toward = (origin: QrPoint, horizontal: QrPoint, vertical: QrPoint): QrPoint => ({ x: origin.x + (horizontal.x - origin.x) * inset + (vertical.x - origin.x) * inset, y: origin.y + (horizontal.y - origin.y) * inset + (vertical.y - origin.y) * inset });
  return { box, corners: [topLeft, topRight, bottomRight, bottomLeft], finders: [
    toward(topLeft, topRight, bottomLeft),
    toward(topRight, topLeft, bottomRight),
    toward(bottomLeft, bottomRight, topLeft),
  ] };
}
