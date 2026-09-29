import { MeterGuidePicker } from "../src/components/MeterGuideOutline";
import { MeterQualityFeedback } from "../src/components/MeterQualityFeedback";
import type { MeterGuide } from "../src/capture/meter-quality";
import { useMeterQualityPreview } from "./useMeterQualityPreview";
import { MeterPanelPreview } from "./MeterPanelPreview";
import { VehicleIdentity } from "../src/components/VehiclePlate";
import { previewVehicle, previewVehicleLabel } from "./vehicle";
import { useState } from "react";
import { View, Text, Pressable, ScrollView, Switch } from "react-native";
import { AppIcon } from "../src/components/AppIcon";
import { CaptureActions } from "../src/components/CaptureActions";
import { photoAssessmentMessage } from "../src/capture/camera-options";
import { useWindowDimensions } from "react-native";
import { ParkingPlaceViewfinder } from "./ParkingPlaceViewfinder";
import { ExtraPhotoFields } from "../src/components/ExtraPhotoFields";
import type { PhotoCaptureTask } from "@repo/core/logic/photoCapturePolicy";

const PREVIEW_PARKING_TASKS: PhotoCaptureTask[] = [
  { id: "oil-sticker", label: "オイル交換シール", stage: "parking", required: true },
  { id: "key-location", label: "鍵を置いた場所", stage: "parking", required: false },
  { id: "fuel-cap", label: "給油口のキャップ", stage: "parking", required: false },
  { id: "parking-place", label: "駐車場所と周囲", stage: "parking", required: false },
];

// ブラウザもこの構成を複製。写真・位置・解析・送信は架空データ。
export function ParkingPreview({ onSaved, onLater, initialStep = "confirm" }: { onSaved: (located: boolean) => void; onLater: () => void; initialStep?: "confirm" | "meter" | "place" | "review" }) {
  const { height } = useWindowDimensions();
  const [step, setStep] = useState<"confirm" | "meter" | "place" | "review">(initialStep);
  const [extraCaptured, setExtraCaptured] = useState<Record<string, boolean>>({});
  const [shot, setShot] = useState(false), [located, setLocated] = useState(true), [failed, setFailed] = useState(false), [error, setError] = useState("");
  const [glare, setGlare] = useState(false), [flash, setFlash] = useState(false);
  const camera = step === "meter" || step === "place";
  const [meterGuide, setMeterGuide] = useState<MeterGuide>("center-right");
  const meterCheck = useMeterQualityPreview(step === "meter" && shot, glare ? "glare" : "good");
  const button = (title: string, action: () => void, testID: string, secondary = false) => <Pressable testID={testID} accessibilityRole="button" onPress={action} style={{ padding: 16, minHeight: 52, borderRadius: 16, backgroundColor: secondary ? "#E6EDF2" : "#FFC52C", alignItems: "center" }}><Text style={{ color: "#192333", fontWeight: "600" }}>{title}</Text></Pressable>;
  if (step === "place") return <ScrollView style={{ flex: 1, backgroundColor: "#08090B" }} contentContainerStyle={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: Math.min(height, 780) }}>
    <ParkingPlaceViewfinder shot={shot} height={Math.max(430, Math.min(height, 780) * 0.67)} />
    <View style={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 28, gap: 20, backgroundColor: "#08090B" }}>
      {shot ? <CaptureActions onRetake={() => setShot(false)} onConfirm={() => { setShot(false); setStep("review"); }} /> : <Pressable testID="parking-photo" accessibilityRole="button" accessibilityLabel="駐車場所を撮影" onPress={() => setShot(true)} style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "white", padding: 4, alignSelf: "center" }}><View style={{ flex: 1, borderRadius: 34, backgroundColor: "white" }} /></Pressable>}
      <Pressable testID="parking-later" accessibilityRole="button" onPress={onLater} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#BEC6D1", fontSize: 14 }}>あとで記録</Text></Pressable>
    </View>
  </ScrollView>;
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
    <Text style={{ fontSize: 24, fontWeight: "700", color: "#192333" }}>{step === "confirm" ? "駐車を完了しましたか？" : step === "meter" ? "メーターパネル全体" : "駐車の記録"}</Text>
    <VehicleIdentity vehicle={previewVehicle} />
    <View style={{ minHeight: camera ? 260 : 180, borderRadius: 20, backgroundColor: camera ? "#21292F" : "#E6EDF2", alignItems: "center", justifyContent: "center", gap: 16, padding: 16 }}>
      {step === "meter" ? <MeterPanelPreview shot={shot} guide={meterGuide} /> : <AppIcon name="location-dot" size={52} color="#526074" iconStyle="solid" />}
      {(step !== "meter" || shot) && <Text style={{ color: camera ? "white" : "#192333", textAlign: "center" }}>{camera ? shot ? "撮影しました（架空）" : step === "meter" ? "" : "車・区画番号・周囲の目印" : step === "review" ? "メーター撮影済み" : located ? "駐車候補（架空）" : "位置を取得できませんでした"}</Text>}
    </View>
    {step === "meter" && !shot && <MeterGuidePicker value={meterGuide} onChange={setMeterGuide} light />}
    {step === "meter" && shot && <MeterQualityFeedback state={meterCheck.state} light />}
    {step === "meter" && !shot && <><Text style={{ color: "#526074" }}>速度計・燃料計・走行距離を入れ、反射を避けて撮影</Text><Pressable accessibilityRole="button" accessibilityLabel={`フラッシュ：${flash ? "自動" : "オフ"}`} onPress={() => setFlash(!flash)} style={{ minHeight: 44, justifyContent: "center" }}><Text>フラッシュ {flash ? "自動" : "オフ"}</Text></Pressable></>}
    {!!error && <Text accessibilityRole="alert" style={{ color: "#B91C1C" }}>{error}</Text>}
    {step === "review" && <ExtraPhotoFields tasks={PREVIEW_PARKING_TASKS} captured={extraCaptured} busy={false} onCapture={task => setExtraCaptured(prev => ({ ...prev, [task.id]: true }))} />}
    {step === "confirm" ? button("ここに駐車しました", () => setStep("meter"), "parking-confirm") : camera ? shot ? <CaptureActions disabled={meterCheck.pending} confirmLabel={step === "meter" ? meterCheck.label : "この写真を使う"} onRetake={() => setShot(false)} onConfirm={() => { setShot(false); setStep("review"); }} /> : <Pressable testID="parking-photo" accessibilityRole="button" accessibilityLabel="写真を撮影" onPress={() => setShot(true)} style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "#526074", padding: 4, alignSelf: "center" }}><View style={{ flex: 1, borderRadius: 34, backgroundColor: "#526074" }} /></Pressable> : <>
      {!located && <Text style={{ color: "#526074" }}>位置は未確定です。写真を送信してください。</Text>}
      <CaptureActions confirmLabel="写真と場所を送信" retakeLabel="撮り直す" onConfirm={() => { if (!extraCaptured["oil-sticker"]) setError("オイル交換シールを撮影してください。"); else if (failed) setError("送信できませんでした。写真を残しています。"); else onSaved(located); }} onRetake={() => { setStep("meter"); setShot(false); setError(""); }} />
    </>}
    {button(step === "confirm" ? "まだ" : "あとで記録", onLater, "parking-later", true)}
    <View style={{ gap: 8 }}><Text style={{ color: "#526074", fontSize: 12 }}>画面確認・架空データ</Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text>確認用：位置が取れる</Text><Switch accessibilityLabel="確認用：位置が取れる" value={located} onValueChange={setLocated} /></View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text>確認用：駐車の送信エラー</Text><Switch accessibilityLabel="確認用：駐車の送信エラー" value={failed} onValueChange={setFailed} /></View>
      {step === "meter" && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text>確認用：光の反射</Text><Switch accessibilityLabel="確認用：光の反射" value={glare} onValueChange={setGlare} /></View>}
    </View>
  </ScrollView>;
}
