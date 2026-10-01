import { View, Text, Pressable } from "react-native";
import { AppIcon } from "../src/components/AppIcon";
import { closeoutProgress, type EndOfDay, type ParkingState } from "./end-of-day";

/** 終了と手続き完了を分離。日報/駐車の順序を固定しない。 */
export function CloseoutSummary({ day, parking, onReport, onParking }: {
  day: EndOfDay; parking: ParkingState; onReport: () => void; onParking: () => void;
}) {
  const progress = closeoutProgress(day, parking);
  const row = (label: string, done: boolean, action: () => void, id: string, note?: string, editableWhenDone = false) => <Pressable testID={id} accessibilityRole="button" disabled={done && !editableWhenDone} onPress={action} accessibilityLabel={`${label}、${done ? editableWhenDone ? "送信済み、修正する" : "完了" : "未送信"}`}
    style={{ minHeight: 92, borderRadius: 18, padding: 18, flexDirection: "row", gap: 14, alignItems: "center", backgroundColor: done ? "#EAF3ED" : "white", borderWidth: 1, borderColor: done ? "#D6E8DC" : "#DCE3EC" }}>
    <AppIcon name={done ? "circle-check" : id === "parking-notice" ? "square-parking" : "file-lines"} size={24} color={done ? "#287958" : "#9A6400"} />
    <View style={{ flex: 1, gap: 6 }}><Text style={{ textAlign: "left", fontSize: 18, fontWeight: "700", color: "#192333" }}>{label}</Text><Text style={{ textAlign: "left", fontSize: 13, color: done ? "#287958" : "#946000" }}>{done ? note || "送信済み" : "必須・未送信"}</Text></View>
    {(!done || editableWhenDone) && <AppIcon name="chevron-right" size={14} color="#526074" />}
  </Pressable>;
  return <View testID="closeout-tasks" style={{ gap: 14 }}>
    <Text style={{ color: "#946000", fontSize: 14, fontWeight: "600" }}>残り{progress.remaining}件</Text>
    {row("駐車の記録", progress.parkingDone, onParking, "parking-notice", parking === "unlocated" ? "写真送信済み・位置は確認中" : undefined)}
    {row("日報", progress.reportDone, onReport, "resume-end-report", undefined, true)}
  </View>;
}
