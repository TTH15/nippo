import type { MeterGuide } from "../src/capture/meter-quality";
import { Image, View } from "react-native";
import { MeterGuideOutline } from "../src/components/MeterGuideOutline";

const samples = {
  "center-right": require("./assets/meter-center-right-sample.png"),
  "dual-center-fuel": require("./assets/meter-dual-center-fuel-sample.png"),
  "center-side": require("./assets/meter-center-side-sample.png"),
  "single-digital": require("./assets/meter-single-digital-sample.png"),
  "triple-center": require("./assets/meter-triple-center-sample.png"),
  round: require("./assets/meter-round-sample.png"), right: require("./assets/meter-right-sample.png"),
  left: require("./assets/meter-left-sample.png"), wide: require("./assets/meter-wide-sample.png"), generic: require("./assets/meter-generic-sample.png"),
};
// 読取前は輪郭ガイドだけを表示し、架空の計器盤は撮影後の確認にだけ使う。
export function MeterPanelPreview({ shot = false, guide = "center-right" }: { shot?: boolean; guide?: MeterGuide }) {
  return <View style={{ position: "relative", width: "100%", aspectRatio: 600 / 340 }}>
    {shot && <Image accessibilityLabel="速度計・燃料計・オドメーターが写った見本" source={samples[guide]} resizeMode="contain" style={{ width: "100%", height: "100%" }} />}
    {!shot && <View pointerEvents="none" style={{ position: "absolute", inset: 0 }}><MeterGuideOutline guide={guide} /></View>}
  </View>;
}
