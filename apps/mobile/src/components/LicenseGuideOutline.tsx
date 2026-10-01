import { View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

// 初期登録の GuidedKycPhoto と同じ免許証レイアウトの撮影ガイド。
export function LicenseGuideOutline() {
  return (
    <View pointerEvents="none" style={{ width: "100%", aspectRatio: 1.58, borderWidth: 3, borderColor: "#FFFFFFE6", borderRadius: 16, overflow: "hidden" }}>
      <Svg width="100%" height="100%" viewBox="0 0 316 200" fill="none" stroke="#FFFFFFE6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <Rect x={22} y={20} width={204} height={16} rx={8} />
        <Rect x={236} y={20} width={58} height={16} rx={8} />
        <Rect x={22} y={48} width={180} height={40} rx={8} />
        <Line x1={32} y1={68} x2={192} y2={68} strokeOpacity={0.7} />
        <Rect x={22} y={98} width={180} height={20} rx={7} fill="#FFFFFF38" stroke="none" />
        <Rect x={22} y={130} width={52} height={44} rx={7} />
        <Line x1={30} y1={152} x2={66} y2={152} strokeOpacity={0.7} />
        <Rect x={88} y={138} width={114} height={36} rx={7} />
        <Line x1={96} y1={156} x2={194} y2={156} strokeOpacity={0.7} />
        {[111, 134, 157, 180].map(x => <Line key={x} x1={x} y1={142} x2={x} y2={170} strokeOpacity={0.7} />)}
        <Rect x={214} y={48} width={80} height={126} rx={8} />
        <Circle cx={254} cy={98} r={17} fill="#FFFFFFE6" stroke="none" />
        <Path d="M224 172 C227 138 239 120 254 120 C269 120 281 138 284 172 Z" fill="#FFFFFFE6" stroke="none" />
      </Svg>
    </View>
  );
}
