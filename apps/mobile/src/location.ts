// 位置取得（任意・非ブロッキング）。許可拒否/失敗でも打刻は止めない（§9）。
import * as Location from "expo-location";
import type { GpsStatus } from "./api/work";

export type GpsFix = {
  lat: number | null;
  lng: number | null;
  status: GpsStatus;
  accuracyM: number | null;
  fixAt: string | null;
};

export const GPS_TIMEOUT_MS = 8_000;
const unavailable = (status: GpsStatus = "unavailable"): GpsFix => ({ lat: null, lng: null, status, accuracyM: null, fixAt: null });

export function getGps(): Promise<GpsFix> {
  return new Promise((resolve) => {
    let finished = false;
    let subscription: Location.LocationSubscription | undefined;
    const finish = (fix: GpsFix) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { subscription?.remove(); } catch { /* 後片付けの失敗でも業務へ結果を返す。 */ }
      resolve(fix);
    };
    const timer = setTimeout(() => finish(unavailable()), GPS_TIMEOUT_MS);
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (finished) return;
        if (status !== "granted") { finish(unavailable("denied")); return; }
        // 一回目の前景測位で解除。タイムアウト後に登録が終わった場合も解除する。
        subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced }, (pos) => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          const age = Date.now() - pos.timestamp;
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
              !Number.isFinite(age) || age < -5_000 || age > 30_000) return;
          finish({ lat, lng, status: "captured", accuracyM: accuracy != null && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
            fixAt: new Date(pos.timestamp).toISOString() });
        }, () => finish(unavailable()));
        if (finished) subscription.remove();
      } catch { finish(unavailable()); }
    })();
  });
}
