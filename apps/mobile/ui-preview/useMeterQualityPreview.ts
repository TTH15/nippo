import { useEffect, useState } from "react";
import { meterQualityCopy, type MeterQualityState } from "../src/capture/meter-quality";
// UI遷移のfixture。画像解析は行わない。実カメラには接続しない。
export function useMeterQualityPreview(active: boolean, scenario: string) {
  const [result, setResult] = useState<MeterQualityState>({ status: "checking" });
  useEffect(() => {
    setResult({ status: "checking" });
    if (!active) return;
    const timer = setTimeout(() => setResult(scenario === "unavailable" ? { status: "unavailable" } : { status: "ready", result: {
      odometerReadable: scenario === "good", fuelReadable: scenario === "good",
      issues: scenario === "good" ? [] : [scenario === "framing" ? "cropped" : scenario === "blur" ? "blur" : scenario === "glare" ? "glare" : scenario === "dark" ? "dark" : scenario === "trip_only" ? "trip_only" : "uncertain"],
    } }), 800);
    return () => clearTimeout(timer);
  }, [active, scenario]);
  const state: MeterQualityState = active ? result : { status: "idle" };
  return { state, pending: active && state.status === "checking", ...meterQualityCopy(state) };
}
