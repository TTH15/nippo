const REQUIRED_PARKING_ANGLES = ["front", "right", "rear", "left"] as const;
export type InspectionAngle = "front" | "right" | "rear" | "left";
const INSPECTION_ANGLES: readonly InspectionAngle[] = ["front", "right", "rear", "left"];

export function parseInspectionPhotos(v: unknown): Array<{ angle: string; path: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ angle: string; path: string }> = [];
  for (const item of v) {
    const angle = (item as { angle?: unknown })?.angle;
    const path = (item as { path?: unknown })?.path;
    if (typeof angle === "string" && typeof path === "string" && path &&
      ((INSPECTION_ANGLES as string[]).includes(angle) || /^extra:[a-z0-9-]{1,50}$/.test(angle))) {
      out.push({ angle, path });
    }
  }
  return out;
}

export function hasParkingInspectionPhotos(photos: Array<{ angle: string; photo_path: string | null }>): boolean {
  const angles = new Set(photos.filter(photo => !!photo.photo_path).map(photo => photo.angle));
  return REQUIRED_PARKING_ANGLES.every(angle => angles.has(angle));
}
