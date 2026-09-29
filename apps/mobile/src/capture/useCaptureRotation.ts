import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { Accelerometer } from "expo-sensors";
import { rotationFromGravity, type CaptureRotation } from "./orientation";

// 撮影中の前景だけ購読する。左右方向は250ms安定してから確定、縦へ戻れば即解除。
export function useCaptureRotation(active: boolean) {
  const [rotation, setRotation] = useState<CaptureRotation>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!active) { setRotation(null); return; }
    let generation = 0;
    let subscription: ReturnType<typeof Accelerometer.addListener> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { generation++; subscription?.remove(); subscription = undefined; clearTimeout(timeout); setRotation(null); };
    const start = async () => {
      stop(); const ticket = generation;
      setUnavailable(false);
      try {
        if (!await Accelerometer.isAvailableAsync()) { if (ticket === generation) setUnavailable(true); return; }
        if (ticket !== generation || AppState.currentState !== "active") return;
        let candidate: CaptureRotation = null, since = 0;
        Accelerometer.setUpdateInterval(100);
        timeout = setTimeout(() => { if (ticket === generation) setUnavailable(true); }, 2500);
        subscription = Accelerometer.addListener(({ x, y, z }) => {
          if (ticket !== generation) return;
          clearTimeout(timeout); setUnavailable(false);
          const next = rotationFromGravity(x, y, z, Platform.OS === "android");
          if (next !== candidate) { candidate = next; since = Date.now(); }
          if (next === null || Date.now() - since >= 250) setRotation(next);
        });
      } catch { if (ticket === generation) setUnavailable(true); }
    };
    if (AppState.currentState === "active") void start();
    const listener = AppState.addEventListener("change", state => { if (state === "active") void start(); else stop(); });
    return () => { stop(); listener.remove(); };
  }, [active]);
  return { rotation, unavailable };
}
