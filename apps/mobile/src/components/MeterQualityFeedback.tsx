import { Text, View } from "react-native";
import { meterQualityCopy, type MeterQualityState } from "../capture/meter-quality";
export function MeterQualityFeedback({ state, light = false }: { state: MeterQualityState; light?: boolean }) {
  const copy = meterQualityCopy(state);
  if (!copy.message) return null;
  return <View testID="meter-quality-feedback" style={{ padding: 12, borderRadius: 12, backgroundColor: light ? "#EEF2F6" : "#101923F2" }}>
    <Text accessibilityLiveRegion="polite" accessibilityRole={copy.warning ? "alert" : undefined} style={{ fontSize: 14, lineHeight: 21, color: copy.warning ? light ? "#92400E" : "#FFE08B" : light ? "#334155" : "#E2E8F0" }}>{copy.message}</Text>
  </View>;
}
