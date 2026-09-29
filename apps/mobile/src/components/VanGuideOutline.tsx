import { Image, View } from "react-native";
import type { InspectionAngle } from "../api/work";

// 13409b3のユーザー提供SVG線画を復元。PNGは同じパスから生成し、Expo Goで表示する。
const guides = { front: require("../capture/assets/van-front.png"), rear: require("../capture/assets/van-rear.png"), side: require("../capture/assets/van-side.png") };
export function VanGuideOutline({ angle }: { angle: InspectionAngle }) {
  const side = angle === "right" || angle === "left";
  return <View pointerEvents="none" style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
    <Image source={guides[side ? "side" : angle as "front" | "rear"]} resizeMode="contain" style={{ width: "90%", height: "88%", transform: [{ scaleX: angle === "right" ? -1 : 1 }] }} />
  </View>;
}
