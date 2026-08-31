import { afterEach, describe, expect, it, vi } from "vitest";
import { addressHits, searchParkingAddresses } from "./parking-geocoding";
import { initialDemo, notificationText, validateParkingPlace } from "./model";

afterEach(() => vi.unstubAllGlobals());
describe("駐車場所のジオコーディング", () => {
  it("保存用・日本語・日本国内の検索を明示し、認証Cookieを送らない", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ properties: { mapbox_id: "a", full_address: "大阪府豊中市", coordinates: { latitude: 34.78, longitude: 135.46 } } }] }) });
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    expect(await searchParkingAddresses(" 豊中市 ", controller.signal, "pk.test")).toEqual([{ id: "a", address: "大阪府豊中市", lat: 34.78, lng: 135.46 }]);
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).origin).toBe("https://api.mapbox.com");
    expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({ q: "豊中市", country: "jp", language: "ja", permanent: "true", autocomplete: "false", limit: "5" });
    expect(init).toMatchObject({ signal: controller.signal, credentials: "omit", cache: "no-store" });
  });
  it("不正座標や住所のない結果を選択候補にしない", () => {
    expect(addressHits({ features: [{ geometry: { coordinates: [135, 34] }, properties: { name: "豊中市", place_formatted: "大阪府" } }, { properties: { full_address: "不正", coordinates: { latitude: NaN, longitude: 999 } } }, { geometry: { coordinates: [135, 34] } }] })).toEqual([{ id: "0", address: "豊中市 大阪府", lat: 34, lng: 135 }]);
    expect(addressHits(null)).toEqual([]);
  });
  it("認証・利用条件・利用上限の失敗を案内し、不正入力は送信しない", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 }); vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(searchParkingAddresses("豊中市", signal, "pk.test")).rejects.toThrow("保存用Geocoding");
    fetcher.mockResolvedValue({ ok: false, status: 429 });
    await expect(searchParkingAddresses("豊中市", signal, "pk.test")).rejects.toThrow("利用上限");
    fetcher.mockClear();
    await expect(searchParkingAddresses(" ", signal, "pk.test")).rejects.toThrow("住所を");
    await expect(searchParkingAddresses("豊中市", signal, "sk.secret")).rejects.toThrow("公開トークン");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("未確定の住所・不正位置を保存せず、確定した住所と目印は配車通知へ反映する", () => {
    const demo = initialDemo(); const base = { ...demo.parkingPlaces[0], address: "大阪府豊中市", detail: "北側入口" };
    expect(validateParkingPlace(demo, base)).toContain("位置を指定");
    expect(validateParkingPlace(demo, { ...base, position: { lat: 999, lng: 135 } })).toContain("位置が正しく");
    demo.parkingPlaces[0] = { ...base, position: { lat: 34.78, lng: 135.46 } };
    expect(validateParkingPlace(demo, demo.parkingPlaces[0])).toBeNull();
    expect(notificationText(demo, demo.loans[0])).toContain("豊中車庫（大阪府豊中市／北側入口）");
  });
});
