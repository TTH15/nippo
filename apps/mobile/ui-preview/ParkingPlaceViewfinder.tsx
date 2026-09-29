import { Text, View } from "react-native";

const cornerSize = 34;
const cornerWidth = 3;

export function ParkingPlaceViewfinder({ shot, height }: { shot: boolean; height: number }) {
  const corner = { position: "absolute" as const, width: cornerSize, height: cornerSize, borderColor: "#F7F9FC", borderWidth: 0 };
  return <View testID="parking-place-viewfinder" style={{ position: "relative", height, width: "100%", overflow: "hidden", backgroundColor: "#252C31" }}>
    <View style={{ position: "absolute", inset: 0, backgroundColor: "#343C41" }} />
    <View style={{ position: "absolute", top: 0, right: 0, bottom: "41%", left: 0, backgroundColor: "#30383E" }} />
    <View style={{ position: "absolute", top: "58%", left: 0, right: 0, height: 2, backgroundColor: "#B6C1C633" }} />
    <View style={{ position: "absolute", top: "70%", left: "20%", right: "20%", bottom: 0, borderLeftWidth: 2, borderRightWidth: 2, borderColor: "#CDD5D94D" }} />
    <View style={{ position: "absolute", inset: 0, backgroundColor: "#0005" }} />
    <Text accessibilityRole="header" style={{ position: "absolute", top: 27, left: 24, right: 24, color: "white", fontSize: 23, fontWeight: "700", textAlign: "center" }}>駐車場所の写真</Text>
    <View pointerEvents="none" style={{ position: "absolute", top: 91, bottom: 36, left: 28, right: 28 }}>
      <View style={{ ...corner, top: 0, left: 0, borderTopWidth: cornerWidth, borderLeftWidth: cornerWidth }} />
      <View style={{ ...corner, top: 0, right: 0, borderTopWidth: cornerWidth, borderRightWidth: cornerWidth }} />
      <View style={{ ...corner, bottom: 0, left: 0, borderBottomWidth: cornerWidth, borderLeftWidth: cornerWidth }} />
      <View style={{ ...corner, bottom: 0, right: 0, borderBottomWidth: cornerWidth, borderRightWidth: cornerWidth }} />
      <Text style={{ position: "absolute", bottom: 18, left: 12, right: 12, color: "white", textAlign: "center", fontSize: 14, fontWeight: "600" }}>車と周囲の目印を入れる</Text>
    </View>
    {shot && <View style={{ position: "absolute", inset: 0, backgroundColor: "#0008", justifyContent: "center", alignItems: "center" }}><Text style={{ color: "white", fontSize: 16 }}>撮影済み（架空）</Text></View>}
  </View>;
}
