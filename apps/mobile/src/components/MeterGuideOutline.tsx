import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { METER_GUIDES, type MeterGuide } from "../capture/meter-quality";
const images = {
  "center-right": require("../capture/assets/meter-center-right-option-4.png"),
  "dual-center-fuel": require("../capture/assets/meter-dual-center-fuel-option-4.png"),
  "center-side": require("../capture/assets/meter-center-side-option-4.png"),
  "single-digital": require("../capture/assets/meter-single-digital-option-4.png"),
  "triple-center": require("../capture/assets/meter-triple-center-option-4.png"),
  round: require("../capture/assets/meter-round-guide.png"), right: require("../capture/assets/meter-right-guide.png"),
  left: require("../capture/assets/meter-left-guide.png"), wide: require("../capture/assets/meter-wide-guide.png"), generic: require("../capture/assets/meter-generic-guide.png"),
};
// 計器の位置だけを案内する。写真自体は切り抜かず、ガイドの一致を品質の合格条件にしない。
export function MeterGuideOutline({ guide = "wide", thumbnail = false }: { guide?: MeterGuide; thumbnail?: boolean }) {
  return <View testID={thumbnail ? undefined : "meter-panel-guide"} pointerEvents="none" style={{ width: "100%", aspectRatio: 600 / 340 }}>
    <Image accessible={!thumbnail} accessibilityLabel="メーターパネル全体の撮影ガイド" source={images[guide]} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
  </View>;
}
export function MeterGuidePicker({ value, onChange, light = false }: { value: MeterGuide; onChange: (value: MeterGuide) => void; light?: boolean }) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="メーターの形を選ぶ" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ minHeight: 44, justifyContent: "center" }}>
      <Text style={{ color: light ? "#334155" : "#E2E8F0", fontSize: 14 }}>ガイド：{METER_GUIDES.find(g => g.id === value)?.label}　{open ? "閉じる" : "変更"}</Text>
    </Pressable>
    {open && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{METER_GUIDES.map(g => <Pressable key={g.id} accessibilityRole="radio" accessibilityLabel={`ガイド：${g.label}`} accessibilityState={{ checked: g.id === value }} onPress={() => { onChange(g.id); setOpen(false); }} style={{ width: "30%", minHeight: 72, padding: 6, borderRadius: 12, borderWidth: 2, borderColor: g.id === value ? "#FFC52C" : "#475569", backgroundColor: "#1E293B", gap: 4 }}>
      <MeterGuideOutline guide={g.id} thumbnail /><Text style={{ color: "white", fontSize: 12, textAlign: "center" }}>{g.label}</Text>
    </Pressable>)}</View>}
  </View>;
}
