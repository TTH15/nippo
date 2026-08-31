import { PREVIEW_MAPBOX_TOKEN } from "./mapbox-config";

export type ParkingPosition = { lat: number; lng: number };
export type ParkingLocation = { address: string; position?: ParkingPosition };
export type AddressHit = ParkingPosition & { id: string; address: string };
export const validPosition = (position: ParkingPosition) => Number.isFinite(position.lat) && Number.isFinite(position.lng) && Math.abs(position.lat) <= 85 && Math.abs(position.lng) <= 180;

export function addressHits(value: unknown): AddressHit[] {
  if (!value || typeof value !== "object" || !("features" in value) || !Array.isArray(value.features)) return [];
  return value.features.flatMap((feature, index) => {
    const p = feature?.properties;
    const lat = p?.coordinates?.latitude ?? feature?.geometry?.coordinates?.[1];
    const lng = p?.coordinates?.longitude ?? feature?.geometry?.coordinates?.[0];
    const address = p?.full_address ?? [p?.name, p?.place_formatted].filter(Boolean).join(" ");
    return typeof address === "string" && address.trim() && typeof lat === "number" && typeof lng === "number" && validPosition({ lat, lng })
      ? [{ id: String(p?.mapbox_id ?? feature?.id ?? index), address, lat, lng }] : [];
  });
}

// 本番地図の検索→ピン配置の流れに合わせ、保存可能なGeocoding v6を使用する。
// Search Boxの一時利用結果を駐車場所マスターへ転用しない。
export async function searchParkingAddresses(query: string, signal: AbortSignal, token = PREVIEW_MAPBOX_TOKEN): Promise<AddressHit[]> {
  const q = query.trim();
  if (!q || q.length > 256 || q.includes(";")) throw new Error("住所を256文字以内で入力してください（セミコロンは使用できません）。");
  if (!token.startsWith("pk.")) throw new Error("Mapboxの公開トークンが設定されていません。");
  const params = new URLSearchParams({ q, country: "jp", language: "ja", limit: "5", autocomplete: "false", permanent: "true", access_token: token });
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`, { signal, credentials: "omit", cache: "no-store" });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("住所検索を利用できません。公開トークン・URL制限・保存用Geocodingの利用条件を確認してください。");
    if (response.status === 429) throw new Error("住所検索の利用上限に達しました。時間をおいて再検索してください。");
    throw new Error("住所を検索できませんでした。時間をおいて再検索してください。");
  }
  return addressHits(await response.json());
}
