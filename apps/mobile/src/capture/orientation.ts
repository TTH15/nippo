export type CaptureRotation = -90 | 90 | null;
export const isSideAngle = (angle: string) => angle === "left" || angle === "right";
// ExpoのiOSは重力方向、Androidは重力に抗する加速度。画面の座標へ揃える。
export function rotationFromGravity(x: number, y: number, z: number, android = false): CaptureRotation {
  if (![x, y, z].every(Number.isFinite) || Math.abs(x) < .78 || Math.abs(y) > .48 || Math.abs(z) > .65) return null;
  return (android ? -x : x) > 0 ? -90 : 90;
}
export const isLandscapePhoto = (width: number, height: number) => width > height && height > 0;
