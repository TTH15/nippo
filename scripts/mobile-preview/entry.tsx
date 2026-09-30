import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LoginScreen } from "../../apps/mobile/src/screens/LoginScreen";
import { PasskeySettings } from "../../apps/mobile/src/components/PasskeySettings";
import { ParkingChoice, type ParkingChoiceValue } from "../../apps/mobile/src/components/ParkingChoice";
import { endParking, parkingForReport } from "../../apps/mobile/src/parking";
import { HomeDesignReview } from "./HomeDesignReview";
import { QrTransitionTest } from "./QrTransitionTest";
import { MeterGuideStudy } from "./MeterGuideStudy";
import { VehiclePhotoTest } from "./VehiclePhotoTest";
import { RestPlaygroundStudy } from "./RestPlaygroundStudy";
function Preview() {
  const [screen, setScreen] = useState(new URLSearchParams(location.search).get("screen") || "login");
  const [parking, setParking] = useState<ParkingChoiceValue>("parked");
  const [gps, setGps] = useState(true);
  const [sameVehicle, setSameVehicle] = useState(true);
  const [sent, setSent] = useState("");
  if (screen === "rest-playground") return <RestPlaygroundStudy />;
  return <><nav className="flex flex-wrap gap-3 p-3 border-b border-brand-200 text-xs">
    <span>隔離プレビュー</span>{["qr-test", "vehicle-photo-test", "meter-guides", "login", "settings", "parking", "home-design"].map((key, i) => <button key={key} onClick={() => setScreen(key)}>{["QR読取テスト", "車体撮影テスト", "メーターガイド比較", "ログイン", "設定", "退勤時の駐車", "ホームの画面案"][i]}</button>)}<a href="?screen=rest-playground">休みの遊び案</a>
    <select aria-label="シナリオ" defaultValue={new URLSearchParams(location.search).get("scenario") || "normal"} onChange={e => { location.search = `screen=${screen}&scenario=${e.target.value}`; }}>
      {["normal", "empty", "long-name", "loading", "error", "storage-error", "cancel", "unsupported", "nofactor"].map(s => <option key={s}>{s}</option>)}
    </select>
  </nav><main className={screen === "home-design" || screen === "meter-guides" || screen === "vehicle-photo-test" ? "max-w-7xl mx-auto" : "max-w-lg mx-auto"}>
    {screen === "home-design" ? <HomeDesignReview /> : screen === "meter-guides" ? <MeterGuideStudy /> : screen === "vehicle-photo-test" ? <VehiclePhotoTest /> : screen === "qr-test" || screen === "base-qr" ? <QrTransitionTest /> : screen === "login" ? <LoginScreen onLoggedIn={() => setScreen("settings")} /> : screen === "settings" ? <div className="p-4"><PasskeySettings /></div> : <div className="p-4 space-y-4">
      <p className="text-sm text-brand-500">業務終了 2/2 — 日報</p>
      <ParkingChoice value={parking} onChange={setParking} />
      <label className="block text-sm"><input type="checkbox" checked={gps} onChange={e => setGps(e.target.checked)} /> 位置取得成功（検証用）</label>
      <label className="block text-sm"><input type="checkbox" checked={sameVehicle} onChange={e => setSameVehicle(e.target.checked)} /> 日報と退勤の車両が同じ（検証用）</label>
      <button className="bg-accent-500 rounded-lg p-3 w-full" onClick={() => {
        const request = endParking("fake-session", "fake-vehicle", parking, { status: gps ? "captured" : "denied", lat: gps ? 35 : null, lng: gps ? 135 : null, accuracyM: 20, fixAt: new Date().toISOString() });
        const result = parkingForReport(sameVehicle ? "fake-vehicle" : "fake-other-vehicle", request);
        setSent(result?.coords ? "業務終了・日報保存・駐車位置保存" : parking === "parked" ? "業務終了・日報保存。車の場所は記録できませんでした。" : "業務終了・日報保存。位置は送信しません。");
      }}>日報を送信して業務終了</button>
      <p role="status">{sent}</p>
    </div>}
  </main></>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
