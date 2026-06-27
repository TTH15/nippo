// 位置取得（任意・非ブロッキング）。許可拒否/失敗でも打刻は止めない（§9）。
import * as Location from "expo-location";
import type { GpsStatus } from "./api/work";

export async function getGps(): Promise<{ lat: number | null; lng: number | null; status: GpsStatus }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return { lat: null, lng: null, status: "denied" };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, status: "captured" };
  } catch {
    return { lat: null, lng: null, status: "unavailable" };
  }
}
