// 地図のナンバー札は、共通 VehiclePlate の寸法・SVG字形を Canvas へ一度描いた1枚画像にする。
// 移動中に多数の CSS mask を再合成しないため（2026-09-02）。同じ番号・色は1回だけ描画する。
import type { VehiclePlateData } from "@repo/core/types";
import { renderPlateImage } from "@/lib/plateImage";

export type MapPlateImage = {
  src: string;
  width: number;
  height: number;
  padding: number;
};

export const MAP_PLATE_WIDTH = 82;
export const MAP_PLATE_HEIGHT = 41;

const cache = new Map<string, Promise<MapPlateImage>>();

export const mapPlateImageKey = (vehicle: VehiclePlateData) => [
  vehicle.number_prefix,
  vehicle.number_class,
  vehicle.number_hiragana,
  vehicle.number_numeric,
  vehicle.plate_color,
].join("|");

export function loadMapPlateImage(vehicle: VehiclePlateData): Promise<MapPlateImage> {
  const key = mapPlateImageKey(vehicle);
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = renderPlateImage(vehicle, MAP_PLATE_WIDTH).then(({ canvas, width, height, padding }) => ({
    src: canvas.toDataURL("image/png"),
    width: width + padding * 2,
    height: height + padding * 2,
    padding,
  }));
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
