import { MyPageReview } from "./MyPageReview";
import { ShiftReview } from "./ShiftReview";
import { RadioField } from "../../apps/web/src/lib/components/RadioField";
import { mapApps, mapAppPreference, parkingMapUrl, type MapApp } from "../../apps/mobile/src/maps";
import { previewParkingPlace } from "../../apps/mobile/ui-preview/parking-place";
import { previewHomeCourse } from "../../apps/mobile/ui-preview/home-course";
import { homeGreeting } from "../../apps/mobile/ui-preview/home-greeting";
import { VehicleIdentity, VehiclePlate } from "../../apps/mobile/src/components/VehiclePlate";
import { CloseoutSummary } from "../../apps/mobile/ui-preview/CloseoutSummary";
import { EndReportReview } from "./EndReportReview";
import { closeoutProgress, finishWork, submitDayReport, displayShiftDate, nextPreviewShiftDate, type EndOfDay } from "../../apps/mobile/ui-preview/end-of-day";
import miniVehicle from "../../apps/mobile/ui-preview/scene/assets/mini-vehicle.png";
import logoIcon from "../../apps/mobile/assets/logo-icon.png";
import { ParkingMapSurface } from "./ParkingMapSurface";
import { previewVehicle } from "../../apps/mobile/ui-preview/vehicle";
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHouse, faCalendarDays, faYenSign, faUser, faBars, faBell, faRoute, faChevronLeft, faChevronDown, faChevronUp, faCarSide, faGasPump, faQrcode, faLocationDot, faCheck, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { SceneSurface } from "./SceneReview";
import { ParkingReview } from "./ParkingReview";
import { CaptureReview } from "./CaptureReview";
import { CaptureReveal, RibbonControl, type RibbonOrigin } from "./RibbonControl";
import { CheckboxField } from "../../apps/web/src/lib/components/CheckboxField";
import { SessionDragSurface } from "./SessionDragSurface";
import { HoldButton } from "./HoldButton";
import { SESSION_SHADE } from "../../apps/mobile/ui-preview/scene/session-presentation";

// 配置/状態の原型: mobileのBottomTabBar、WorkingMiniBar、PunchButton（800ms）。
// 新しいシェルの操作検討専用。本番コンポーネントの完成や実機検証を意味しない。
const tabs = [
  ["ホーム", faHouse], ["シフト", faCalendarDays],
  ["報酬", faYenSign], ["マイページ", faUser],
] as const;
type Session = "work" | "move" | null;
const todayInJapan = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export function SessionShellReview({ ribbon = false }: { ribbon?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const [accountDirty, setAccountDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [haptics, setHaptics] = useState(() => { try { return localStorage.getItem("hakotora_preview_haptics") !== "off"; } catch { return true; } });
  const [settingsError, setSettingsError] = useState("");
  const [hapticTest, setHapticTest] = useState(false);
  const changeHaptics = (value: boolean) => { try { localStorage.setItem("hakotora_preview_haptics", value ? "on" : "off"); setHaptics(value); setSettingsError(""); } catch { setSettingsError("設定を保存できませんでした。"); } };
  const [ribbonOrigin, setRibbonOrigin] = useState<RibbonOrigin | null>(null);
  const [ribbonAttempt, setRibbonAttempt] = useState(0);
  function closeCapture(target: "start" | "end") {
    setScan(null); setEnding(false); setRibbonOrigin(null); setRibbonAttempt(value => value + 1);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="ribbon-${target}"]`)?.focus({ preventScroll: true }));
  }
  const [locationKnown, setLocationKnown] = useState(new URLSearchParams(window.location.search).get("scenario") !== "empty");
  const [mapApp, setMapApp] = useState<MapApp>(() => { try { return mapAppPreference(localStorage.getItem("hakotora_preview_map_app"), "web"); } catch { return "google"; } });
  const changeMapApp = (value: MapApp) => { try { localStorage.setItem("hakotora_preview_map_app", value); setMapApp(value); setSettingsError(""); } catch { setSettingsError("地図の設定を保存できませんでした。"); } };
  const initialState = new URLSearchParams(window.location.search).get("state");
  const [endOfDay, setEndOfDay] = useState<EndOfDay | null>(() => initialState === "done" ? { ...finishWork("2026-09-23", "2026-09-23"), report: "submitted" } : ["end-report", "closeout"].includes(initialState ?? "") ? finishWork("2026-09-23", "2026-09-23") : null);
  const [reportOpen, setReportOpen] = useState(initialState === "end-report");
  const [reportSubmittedBeforeFinish, setReportSubmittedBeforeFinish] = useState(false);
  const [nextShift, setNextShift] = useState(true);
  const [off, setOff] = useState(initialState === "off");
  const [theme, setTheme] = useState("light");
  const [tab, setTab] = useState(initialState === "shifts" ? "シフト" : initialState === "mypage" ? "マイページ" : "ホーム");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationRead, setNotificationRead] = useState(false);
  const initiallyWorking = new URLSearchParams(window.location.search).get("state") === "working";
  const [session, setSession] = useState<Session>(initiallyWorking ? "work" : null);
  const [expanded, setExpanded] = useState(initiallyWorking && new URLSearchParams(window.location.search).get("collapsed") !== "1");
  const [scan, setScan] = useState<Session>(["side-photo", "meter-photo"].includes(initialState ?? "") ? "work" : null);
  const [fuel, setFuel] = useState(false);
  const [fuelRequested, setFuelRequested] = useState(true);
  const [ending, setEnding] = useState(false);
  const [parking, setParking] = useState<"pending" | "located" | "unlocated" | null>(initialState === "done" ? "located" : ["end-report", "closeout"].includes(initialState ?? "") ? "pending" : null);
  const [parkingOpen, setParkingOpen] = useState(initialState === "parking-place");
  const [paused, setPaused] = useState(false);
  const [failure, setFailure] = useState(false);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const startY = useRef<number | null>(null);
  const sessionScroll = useRef<HTMLDivElement | null>(null);
  const isDark = theme === "dark";
  const ink = isDark ? "#F4F7FC" : "#192333";
  const surface = isDark ? "#203048" : "#fff";
  const bg = isDark ? "#121C2B" : "#F6F8FB";
  useEffect(() => { if (expanded) closeButton.current?.focus(); }, [expanded]);
  const settingsWasOpen = useRef(false);
  useEffect(() => {
    if (!settingsOpen && settingsWasOpen.current) document.querySelector<HTMLButtonElement>('[data-testid="account-sliders"]')?.focus({ preventScroll: true });
    settingsWasOpen.current = settingsOpen;
  }, [settingsOpen]);
  function closeSheet() { setExpanded(false); setEnding(false); requestAnimationFrame(() => returnFocus.current?.focus()); }
  const control = { padding: "10px 14px", border: "1px solid #94A3B8", borderRadius: 12, minHeight: 44 };
  const scene = () => <div style={{ height: 130, borderRadius: 22, overflow: "hidden" }}>{!expanded && <SceneSurface mode="idle" dark={isDark} />}</div>;
  return <div className="space-y-4" style={{ maxWidth: "calc(100vw - 32px)", minWidth: 0 }}>
    <p className="text-sm text-brand-500">{ribbon ? "スライド・稼働中バー・全画面撮影の操作確認。QR・写真・位置・送信は架空です。" : "開閉・タブ・長押しの操作モック。QR・位置・給油・保存はすべて架空です。"}</p>
    <div className="flex flex-wrap gap-2">
      <button style={control} onClick={() => setTheme(isDark ? "light" : "dark")}>{isDark ? "ライトへ" : "ダークへ"}</button>
      <button style={control} onClick={() => { setRibbonOrigin(null); setRibbonAttempt(value => value + 1); setSession(null); setEndOfDay(null); setReportOpen(false); setScan(null); setExpanded(false); setEnding(false); setFuel(false); setParking(null); setParkingOpen(false); setMapOpen(false); setLocationKnown(true); setOff(false); setTab("ホーム"); }}>初期状態へ</button>
      <button style={control} onClick={() => setFailure(!failure)}>{failure ? "表示を復旧" : "表示失敗を試す"}</button>
    </div>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={locationKnown} onChange={e => setLocationKnown(e.target.checked)} />確認用：駐車位置が確定</label>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={off} onChange={e => setOff(e.target.checked)} />確認用：今日は休み</label>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={fuelRequested} onChange={e => setFuelRequested(e.target.checked)} />架空の移動依頼に「給油あり」を指定</label>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={nextShift} onChange={e => setNextShift(e.target.checked)} />確認用：次の稼働予定あり</label>
    <div data-testid="session-phone" style={{ width: "100%", maxWidth: 390, margin: "0 auto", position: "relative", height: 780, overflow: "hidden", border: "1px solid #CBD5E1", borderRadius: 28, background: bg, color: ink }}>
      <div inert={reportOpen || expanded || !!scan || ending || parkingOpen || settingsOpen} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <header style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 8px", background: bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}><img src={logoIcon} alt="" style={{ width: 42, height: 42, borderRadius: 8 }} /><strong style={{ color: ink, fontSize: 23, fontWeight: 800 }}>ハコ虎</strong></div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><button data-testid="open-notifications" aria-label={notificationRead ? "通知" : "通知、未読1件"} onClick={() => setNotificationsOpen(true)} style={{ width: 44, height: 44, position: "relative", display: "grid", placeItems: "center" }}><FontAwesomeIcon icon={faBell} style={{ width: 21, height: 21 }} />{!notificationRead && <span style={{ position: "absolute", top: 6, right: 7, width: 7, height: 7, borderRadius: "50%", background: "#D64545" }} />}</button><button data-testid="open-main-menu" aria-label="メニューを開く" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(true)} style={{ width: 44, height: 44, borderRadius: 22, display: "grid", placeItems: "center" }}><FontAwesomeIcon icon={faBars} style={{ width: 22, height: 22 }} /></button></div>
        </header>
        <div data-testid="home-scroll" style={{ flex: 1, minHeight: 0, overflow: dragging ? "hidden" : "auto", padding: ribbon ? 16 : 20 }}>
          {tab !== "ホーム" && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><p style={{ fontSize: 13 }}>9月23日（水）</p></div>}
          {!(tab === "ホーム" && (endOfDay && !session || !off && !session)) && <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{tab === "ホーム" ? session ? session === "work" ? "稼働中" : "車両移動中" : off ? "今日はお休み" : "今日の稼働" : tab}</h2>}
          {tab === "ホーム" ? endOfDay && !session ? <div data-testid="end-of-day-home" style={{ display: "flex", flexDirection: "column", gap: 24, paddingTop: 36 }}>
            <h2 style={{ fontSize: 28, fontWeight: 700 }}>{closeoutProgress(endOfDay, parking).complete ? "お疲れ様でした" : "終了の手続き"}</h2>
            <p style={{ marginTop: -14, fontSize: 15 }}>{closeoutProgress(endOfDay, parking).complete ? "今日の手続きは完了です" : "稼働は終了しました"}</p>
            {!closeoutProgress(endOfDay, parking).complete ? <CloseoutSummary day={endOfDay} parking={parking} onReport={() => setReportOpen(true)} onParking={() => setParkingOpen(true)} /> : <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12, background: surface, borderRadius: 22 }}><p style={{ opacity: .7, fontSize: 13 }}>次の稼働</p><strong style={{ fontSize: 23 }}>{nextShift ? displayShiftDate(nextPreviewShiftDate(endOfDay.finishedOn)) : "まだ予定はありません"}</strong><button onClick={() => setTab("シフト")} style={{ minHeight: 44, textAlign: "left", fontSize: 15, opacity: .7 }}>シフトを確認　<FontAwesomeIcon icon={faChevronRight} style={{ width: 12 }} /></button></div>}
            {closeoutProgress(endOfDay, parking).complete && parking === "unlocated" && <p style={{ fontSize: 13 }}>駐車写真は送信済みです。位置は運営が確認します。</p>}
          </div> : off && !session ? <div data-testid="off-day-home" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div data-testid="off-day-scene" style={{ height: 380, borderRadius: 22, overflow: "hidden" }}><SceneSurface mode="off" dark={isDark} failure={failure} /></div>
            <div style={{ borderTop: "1px solid #DCE3EC", paddingTop: 17, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: "#526074", fontSize: 13, fontWeight: 600 }}>次の稼働</span>
              <button data-testid="off-next-shift" onClick={() => setTab("シフト")} style={{ minHeight: 42, display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}><strong style={{ flex: 1, fontSize: 23 }}>{nextShift ? displayShiftDate(nextPreviewShiftDate(todayInJapan())) : "予定なし"}</strong><FontAwesomeIcon icon={faChevronRight} style={{ width: 15, color: "#526074" }} /></button>
              {nextShift && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><span style={{ display: "flex", alignItems: "center", gap: 8, color: "#526074", fontSize: 15, fontWeight: 600 }}><FontAwesomeIcon icon={faRoute} style={{ width: 18 }} />{previewHomeCourse.name}</span><strong style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>7:30</strong></div>}
            </div>
            <button data-testid="off-rewards" onClick={() => setTab("報酬")} style={{ alignSelf: "flex-start", minHeight: 44, display: "flex", alignItems: "center", gap: 8, color: "#526074", fontSize: 14, fontWeight: 600 }}>報酬を見る <FontAwesomeIcon icon={faChevronRight} style={{ width: 12 }} /></button>
            <button data-testid="off-extra-work" onClick={() => { setRibbonOrigin(null); setScan("work"); }} style={{ alignSelf: "flex-start", minHeight: 48, display: "flex", alignItems: "center", gap: 8, color: "#526074", fontSize: 14, fontWeight: 600 }}>臨時で稼働 <FontAwesomeIcon icon={faChevronRight} style={{ width: 12 }} /></button>
          </div> : <>
            {(!off || session) && <>{!session && <div style={{ marginBottom: 15 }}><h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 7 }}>{homeGreeting(Date.now())}</h2><div aria-label={`本日の担当、${previewHomeCourse.name}`} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 28, color: "#526074" }}><span style={{ color: "#64748B", fontSize: 12, fontWeight: 600 }}>本日の担当</span><span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600 }}><FontAwesomeIcon icon={faRoute} style={{ width: 18, height: 18 }} />{previewHomeCourse.name}</span></div></div>}<div data-testid="assigned-vehicle" style={{ overflow: "hidden", borderRadius: 22, border: "1px solid #DCE3EC", background: surface }}>
              {!session && <div style={{ height: 320, overflow: "hidden" }}><ParkingMapSurface enabled={locationKnown && (parking === null || parking === "located")} /></div>}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px" }}>{(!locationKnown || (parking !== null && parking !== "located") || !!session) ? <div style={{ flex: 1, minWidth: 0 }}>{scene()}</div> : <strong style={{ flex: 1, fontSize: 18 }}>エブリイ</strong>}{(!locationKnown || (parking !== null && parking !== "located") || !!session) ? <VehicleIdentity vehicle={previewVehicle} width={128} /> : <VehiclePlate vehicle={previewVehicle} width={128} />}</div>
              {!session && <a aria-label="駐車場所を地図で開く" aria-disabled={!locationKnown || (parking !== null && parking !== "located")} href={locationKnown && (parking === null || parking === "located") ? parkingMapUrl(mapApp, previewParkingPlace) : undefined} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 16px", borderTop: "1px solid #DCE3EC", color: ink, textDecoration: "none" }}>
                <FontAwesomeIcon icon={faLocationDot} style={{ width: 19, color: "#355779" }} /><span style={{ flex: 1 }}><strong style={{ display: "block", fontSize: 16 }}>{locationKnown && (parking === null || parking === "located") ? previewParkingPlace.name : "位置を確認中"}</strong><small style={{ display: "block", color: "#526074", fontSize: 11 }}>{locationKnown && (parking === null || parking === "located") ? previewParkingPlace.address : "運営に駐車場所を確認してください"}</small></span>{locationKnown && (parking === null || parking === "located") && <FontAwesomeIcon icon={faChevronRight} style={{ width: 13, color: "#526074" }} />}
              </a>}
            </div></>}
            {!session && parking === "pending" && <div style={{ marginTop: 16 }}><p style={{ fontSize: 12 }}>確認用：駐車候補の通知</p><button style={{ ...control, width: "100%" }} onClick={() => setParkingOpen(true)}>駐車を完了しましたか？</button></div>}
            {!session && parking && parking !== "pending" && <p>{parking === "located" ? "駐車写真と場所を記録しました（架空）" : "駐車写真を記録しました。位置は未確定です（架空）"}</p>}
            {!session ? <div style={{ display: "grid", justifyItems: "center", gap: 10, marginTop: 10 }}>
              {!off ? ribbon ? <RibbonControl key={`start:${ribbonAttempt}`} mode="start" onInteractionChange={setDragging} onOpen={origin => { setRibbonOrigin(origin); setScan("work"); }} /> : <HoldButton mode="start" onTriggered={() => setScan("work")} /> : <button style={control} onClick={() => { setRibbonOrigin(null); setScan("work"); }}>臨時で稼働</button>}
            </div> : <div style={{ display: "grid", gap: 10, marginTop: 24 }}><p>{session === "work" ? "稼働中" : "車両移動中"}</p>{session === "work" && <button data-testid="working-report" style={control} onClick={() => setReportOpen(true)}>日報を書く・修正する</button>}</div>}
          </> : tab === "シフト" ? <ShiftReview /> : tab === "報酬" ? <p>今月の報酬はまだ確定していません</p> : <MyPageReview onDirtyChange={setAccountDirty} onAppSettings={() => setSettingsOpen(true)} />}
        </div>
        {session && <button ref={returnFocus} data-testid="session-mini-bar" aria-label={`${session === "work" ? "稼働中" : "車両移動中"}の画面を開く`} onClick={() => setExpanded(true)} style={{ margin: "0 10px 8px", minHeight: 72, padding: "6px 16px", display: "flex", alignItems: "center", gap: 10, textAlign: "left", color: "white", border: "1px solid #FFFFFF24", borderRadius: 22, background: "#192B46" }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, flexShrink: 0, borderRadius: "50%", background: "#4AE59B" }} />
          <img src={miniVehicle} alt="" style={{ width: 78, height: 54, objectFit: "contain" }} />
          <span style={{ flex: 1 }}><strong style={{ display: "block", fontSize: 15 }}>{session === "work" ? "稼働中" : "車両移動中"}</strong>
            <span style={{ display: "block", color: "#D7E2F1", fontSize: 12, marginTop: 2 }}>{session === "work" ? "2時間18分" : "18分"}</span>
          </span><FontAwesomeIcon icon={faChevronUp} style={{ width: 15 }} />
        </button>}
      </div>
      {menuOpen && <div style={{ position: "absolute", inset: 0, zIndex: 20 }} onKeyDown={e => { if (e.key === "Escape") setMenuOpen(false); }}>
        <button data-testid="close-main-menu" aria-label="メニューを閉じる" onClick={() => setMenuOpen(false)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "#19233344" }} />
        <div role="menu" aria-label="画面を選ぶ" style={{ position: "absolute", top: 60, right: 16, width: 212, padding: 6, borderRadius: 16, background: "white", boxShadow: "0 8px 24px #19233330", color: "#192333" }}>
          {tabs.map(([label, icon]) => <button key={label} role="menuitem" data-testid={`main-menu-${label}`} aria-current={tab === label ? "page" : undefined} onClick={() => { if (label === tab || !accountDirty || window.confirm("振込口座の変更を破棄して移動しますか？")) { setTab(label); setMenuOpen(false); } }} style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", minHeight: 48, padding: "0 13px", borderRadius: 11, textAlign: "left", background: tab === label ? "#FFF5D5" : "transparent", color: "#192333", fontWeight: tab === label ? 700 : 500, fontSize: 16 }}><FontAwesomeIcon icon={icon} style={{ width: 17 }} />{label}</button>)}
        </div>
      </div>}
      {notificationsOpen && <div data-testid="notifications-preview" style={{ position: "absolute", inset: 0, zIndex: 15, overflowY: "auto", background: "#F6F8FB", color: "#192333" }}>
        <header style={{ minHeight: 60, padding: "8px 16px", display: "flex", alignItems: "center", gap: 12, background: "white" }}><button aria-label="ホームへ戻る" onClick={() => setNotificationsOpen(false)} style={{ width: 44, height: 44, display: "grid", placeItems: "center" }}><FontAwesomeIcon icon={faChevronLeft} style={{ width: 17 }} /></button><h2 style={{ fontSize: 20, fontWeight: 700 }}>通知</h2></header>
        <div style={{ padding: 16 }}>{!notificationRead && <button onClick={() => setNotificationRead(true)} style={{ display: "block", marginLeft: "auto", minHeight: 44, color: "#355779", fontSize: 13 }}>すべて既読にする</button>}<button onClick={() => setNotificationRead(true)} style={{ width: "100%", padding: 16, textAlign: "left", borderRadius: 14, border: "1px solid #DCE3EC", background: notificationRead ? "white" : "#FFF8E8" }}><strong style={{ display: "block", fontSize: 16 }}>明日の配送について</strong><span style={{ display: "block", marginTop: 6, color: "#526074", fontSize: 13 }}>集合場所をご確認ください。</span></button></div>
      </div>}
      {reportOpen && <CaptureReveal origin={null} onCancel={() => setReportOpen(false)}><div style={{ position: "absolute", inset: 0, overflow: "auto", background: "#F6F8FB", color: "#192333", padding: 20 }}><EndReportReview onBack={() => setReportOpen(false)} onSubmitted={() => { if (session === "work") setReportSubmittedBeforeFinish(true); setEndOfDay(day => submitDayReport(day, "2026-09-23")); setReportOpen(false); setTab("ホーム"); }} /></div></CaptureReveal>}
      {settingsOpen && <div role="dialog" aria-modal="true" aria-label="地図・振動" onKeyDown={e => { if (e.key === "Escape") setSettingsOpen(false);
        if (e.key === "Tab") {
          const nodes = e.currentTarget.querySelectorAll<HTMLElement>("button,input");
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        } }} style={{ position: "absolute", inset: 0, zIndex: 12, background: bg, padding: 20, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}><h2 style={{ fontSize: 23, fontWeight: 700 }}>地図・振動</h2><button autoFocus style={control} onClick={() => setSettingsOpen(false)}>閉じる</button></div>
        <CheckboxField label="スライドの振動" checked={haptics} onCheckedChange={changeHaptics} variant="row" />
        <button style={{ ...control, marginTop: 16 }} disabled={!haptics} onClick={() => setHapticTest(true)}>振動を試す</button>
        {hapticTest && <p role="status" style={{ marginTop: 12 }}>iPhoneのExpo Goでお試しください。</p>}
        <fieldset style={{ display: "grid", gap: 8, marginTop: 24 }}><legend style={{ marginBottom: 12, fontWeight: 600 }}>地図アプリ</legend>{mapApps.map(option => <RadioField key={option.value} name="map-app" label={option.label} checked={mapApp === option.value} onSelect={() => changeMapApp(option.value)} />)}</fieldset>
        <p style={{ fontSize: 13, marginTop: 12 }}>未インストールの場合はブラウザで開きます。</p>
        {settingsError && <p role="alert">{settingsError}</p>}
      </div>}
      {parkingOpen && <ParkingReview initialStep={initialState === "parking-place" ? "place" : undefined} onSaved={located => { setParking(located ? "located" : "unlocated"); setParkingOpen(false); if (endOfDay?.report === "pending") setReportOpen(true); }} onLater={() => setParkingOpen(false)} />}
      {scan && <CaptureReveal origin={ribbon ? ribbonOrigin : null} onCancel={() => closeCapture("start")}><CaptureReview cameraLayout={ribbon} target="in" purpose={scan} onComplete={() => { setRibbonOrigin(null); setSession(scan); if (scan === "work") setEndOfDay(null); setParking(null); setScan(null); setFuel(false); setEnding(false); setExpanded(true); }} onCancel={() => closeCapture("start")} /></CaptureReveal>}
      {ending && session && <CaptureReveal origin={ribbon ? ribbonOrigin : null} onCancel={() => closeCapture("end")}><CaptureReview cameraLayout={ribbon} target="out" purpose={session} onComplete={() => { setRibbonOrigin(null); if (session === "work") { const day = finishWork("2026-09-23", "2026-09-23"); setEndOfDay(reportSubmittedBeforeFinish ? submitDayReport(day, day.workDate) : day); setReportOpen(false); setTab("ホーム"); } setSession(null); setParking("pending"); setExpanded(false); setEnding(false); }} onCancel={() => closeCapture("end")} /></CaptureReveal>}
      {session && expanded && <SessionDragSurface blocked={ending} ribbonActive={dragging} scroll={sessionScroll} onClose={closeSheet} label={session === "work" ? "稼働中モーダル" : "車両移動中モーダル"}>
        <div style={{ position: "absolute", inset: 0 }}><SceneSurface mode={session === "work" ? "working" : "moving"} immersive paused={paused} failure={failure} /></div>
        <div style={{ position: "absolute", inset: 0, background: SESSION_SHADE, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 9, left: "calc(50% - 22px)", width: 44, height: 5, borderRadius: 3, background: "#FFFFFF88" }} />
        <div ref={sessionScroll} data-testid="session-scroll" style={{ position: "relative", height: "100%", overflowY: dragging ? "hidden" : "auto" }}><div style={{ minHeight: "100%", padding: "28px 24px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#4AE59B", flexShrink: 0 }} />
            <h2 style={{ fontSize: 28, fontWeight: 700, flex: 1 }}>{session === "work" ? "稼働中" : "車両移動中"}</h2>
            <button ref={closeButton} aria-label="モーダルを閉じる" onClick={closeSheet} style={{ minWidth: 44, height: 44 }}
              onPointerDown={e => { startY.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerUp={e => { if (startY.current !== null && e.clientY - startY.current > 65) closeSheet(); startY.current = null; }}>
              <FontAwesomeIcon icon={faChevronDown} />
            </button>
          </div>
          <p style={{ color: "#E6EFFA", fontSize: 15, marginTop: -14 }}>{session === "work" ? "2時間18分" : "18分"}</p>
          <div style={{ flex: 1, minHeight: 200 }} />
          <div style={{ padding: 17, borderRadius: 20, border: "1px solid #FFFFFF26", background: "#14263ACC", display: "flex", alignItems: "center", gap: 16 }}>
            <FontAwesomeIcon icon={faCarSide} style={{ width: 25 }} /><div><p style={{ color: "#C6D4E5", fontSize: 12, marginBottom: 4 }}>使用車両</p><VehicleIdentity vehicle={previewVehicle} light /></div>
          </div>
          {session === "move" && <><p>届け先　中央車庫</p>{fuelRequested && !fuel && <p>給油の依頼あり</p>}<button style={{ ...control, width: "100%" }} onClick={() => setFuel(true)} disabled={fuel}>
            <FontAwesomeIcon icon={faGasPump} />　{fuel ? "給油済み" : "給油を記録"}
          </button></>}
          {session === "work" ? ribbon ? <RibbonControl key={`end:${ribbonAttempt}`} mode="end" onInteractionChange={setDragging} onOpen={origin => { setRibbonOrigin(origin); setEnding(true); }} /> : <div style={{ alignSelf: "center" }}><HoldButton mode="end" onTriggered={() => setEnding(true)} /></div>
              : <button style={{ ...control, width: "100%", background: "#E73949", border: 0 }} onClick={() => { setRibbonOrigin(null); setEnding(true); }}>移動終了</button>}
          {session === "work" && <button data-testid="active-report" style={{ ...control, width: "100%", background: "white", color: "#192333" }} onClick={() => { setExpanded(false); setReportOpen(true); }}>日報を書く・修正する</button>}
        </div></div>
        <div style={{ position: "absolute", top: 104, left: 24, display: "flex", gap: 18, fontSize: 12, color: "#F3F6FB" }}>
          {!failure && <button style={{ minHeight: 44 }} onClick={() => setPaused(!paused)}>{paused ? "動きを再開" : "動きを止める"}</button>}
          <button style={{ minHeight: 44 }} onClick={() => setFailure(!failure)}>{failure ? "3Dを再表示" : "静止画で表示"}</button>
        </div>
      </SessionDragSurface>}
    </div>
    <p className="text-sm text-brand-500">{ribbon ? "リボンは端で離すと全画面の撮影へ切り替わります。途中で離すと戻ります。" : "開始・終了は円周ゲージを800ms長押し。"}振動はiPhoneのExpo Goで確認します。ブラウザの設定は表示確認用で端末とは同期しません。背景はnativeと同じ3D、構成はNativeHomePreviewを複製しています。駐車場所は公開施設の見本です。地図リンクのみ実際の外部サービスを開きます。QR→対象者の車両写真→メーター写真→送信まで確認できます。実カメラ・通知・送信は行いません。</p>
  </div>;
}
