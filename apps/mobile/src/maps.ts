export type MapApp = "apple" | "google";
export type MapDestination = { name: string; latitude: number; longitude: number };
export const mapApps = [{ value: "apple", label: "Appleマップ" }, { value: "google", label: "Googleマップ" }] as const;
export function mapAppPreference(value: unknown, platform: string): MapApp {
  return value === "apple" || value === "google" ? value : platform === "ios" ? "apple" : "google";
}

// 出発地・車両番号・利用者情報は渡さない。経路と移動手段は地図側で選ぶ。
export function parkingMapUrl(app: MapApp, place: MapDestination): string {
  const { latitude, longitude } = place;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error("駐車位置を確認できませんでした。");
  const coordinates = encodeURIComponent(`${latitude},${longitude}`);
  return app === "apple"
    ? `https://maps.apple.com/?ll=${coordinates}&q=${encodeURIComponent(place.name)}`
    : `https://www.google.com/maps/search/?api=1&query=${coordinates}`;
}
