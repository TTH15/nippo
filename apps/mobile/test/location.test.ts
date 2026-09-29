import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ requestForegroundPermissionsAsync: vi.fn(), watchPositionAsync: vi.fn() }));
vi.mock("expo-location", () => ({ ...mock, Accuracy: { Balanced: 3 } }));
import { getGps, GPS_TIMEOUT_MS } from "../src/location";
import { endParking, parkingForReport } from "../src/parking";

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());
it("位置権限拒否でも退勤用の結果を返す", async () => {
  mock.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });
  const gps = await getGps();
  expect(gps.status).toBe("denied"); expect(mock.watchPositionAsync).not.toHaveBeenCalled();
  expect(endParking("session", "vehicle", "parked", gps)).toBeNull();
});
it("権限ダイアログの遅延後に測位を開始しない", async () => {
  let grant!: (value: unknown) => void;
  mock.requestForegroundPermissionsAsync.mockReturnValue(new Promise(resolve => { grant = resolve; }));
  const result = getGps(); await vi.advanceTimersByTimeAsync(GPS_TIMEOUT_MS);
  expect((await result).status).toBe("unavailable");
  grant({ status: "granted" }); await Promise.resolve();
  expect(mock.watchPositionAsync).not.toHaveBeenCalled();
});
it("測位タイムアウトで購読解除し、遅延応答を採用しない", async () => {
  const remove = vi.fn();
  mock.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mock.watchPositionAsync.mockResolvedValue({ remove });
  const result = getGps(); await vi.advanceTimersByTimeAsync(GPS_TIMEOUT_MS);
  expect((await result).status).toBe("unavailable"); expect(remove).toHaveBeenCalledTimes(1);
  mock.watchPositionAsync.mock.calls[0][1]({ coords: { latitude: 35, longitude: 135, accuracy: 10 }, timestamp: Date.now() });
  expect((await result).lat).toBeNull();
});
it("購読登録自体が遅れても後から解除する", async () => {
  const remove = vi.fn(); let registered!: (value: unknown) => void;
  mock.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mock.watchPositionAsync.mockReturnValue(new Promise(resolve => { registered = resolve; }));
  const result = getGps(); await vi.advanceTimersByTimeAsync(GPS_TIMEOUT_MS);
  expect((await result).status).toBe("unavailable"); registered({ remove }); await Promise.resolve();
  expect(remove).toHaveBeenCalledTimes(1);
});
it("古い位置を無視し、新しい測位を駐車へ送り再送キーを固定する", async () => {
  const remove = vi.fn(); mock.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mock.watchPositionAsync.mockImplementation(async (_options, success) => {
    success({ coords: { latitude: 34, longitude: 134, accuracy: 10 }, timestamp: Date.now() - 60_000 });
    success({ coords: { latitude: 35, longitude: 135, accuracy: 20 }, timestamp: Date.now() });
    return { remove };
  });
  const gps = await getGps(); await Promise.resolve();
  expect(gps).toMatchObject({ lat: 35, lng: 135, status: "captured", accuracyM: 20 });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(endParking("session", "vehicle", "parked", gps)).toEqual(endParking("session", "vehicle", "parked", gps));
  expect(endParking("session", "vehicle", "parked", gps)).toMatchObject({ clientKey: "session:parking", detectedBy: "session_end", coords: { lat: 35, accuracyM: 20 } });
  expect(endParking("session", "vehicle", "handed_over", gps)).toMatchObject({ coords: null, detectedBy: null });
});
it("測位APIの失敗を業務側へthrowしない", async () => {
  mock.requestForegroundPermissionsAsync.mockRejectedValue(new Error("OS failure"));
  expect((await getGps()).status).toBe("unavailable"); expect(vi.getTimerCount()).toBe(0);
});
it("購読解除のOSエラーでも時間上限で結果を返す", async () => {
  mock.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mock.watchPositionAsync.mockResolvedValue({ remove: () => { throw new Error("cleanup failed"); } });
  const result = getGps(); await vi.advanceTimersByTimeAsync(GPS_TIMEOUT_MS);
  expect((await result).status).toBe("unavailable");
});

it("日報の車両が変わっても退勤した車の位置を転用しない", () => {
  const request = endParking("session", "ended-vehicle", "parked", {
    status: "captured", lat: 35, lng: 135, accuracyM: 20, fixAt: new Date().toISOString(),
  });
  expect(parkingForReport("ended-vehicle", request)).toMatchObject({ vehicleId: "ended-vehicle", clientKey: "session:parking" });
  expect(parkingForReport("another-vehicle", request)).toBeNull();
  expect(parkingForReport(null, request)).toBeNull();
  expect(parkingForReport("ended-vehicle", null)).toBeNull();
});
it("引き渡しも日報の別車両には付けない", () => {
  const request = endParking("session", "ended-vehicle", "handed_over", {
    status: "denied", lat: null, lng: null, accuracyM: null, fixAt: null,
  });
  expect(parkingForReport("another-vehicle", request)).toBeNull();
  expect(parkingForReport("ended-vehicle", request)).toMatchObject({ status: "handed_over", coords: null });
});
