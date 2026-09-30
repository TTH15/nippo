import { AccountDetailScreen } from "../src/screens/AccountDetailScreen";
import { NotificationsScreen } from "../src/screens/NotificationsScreen";
import { accountSectionTitles, type AccountSection } from "../src/components/MyPageMenu";
import { MapPreferences, useMapPreferences } from "./MapPreferences";
import { mapApps } from "../src/maps";
import { previewParkingPlace } from "./parking-place";
import { CourseLabel } from "./CourseLabel";
import { previewHomeCourse } from "./home-course";
import { homeGreeting } from "./home-greeting";
import { CloseoutSummary } from "./CloseoutSummary";
import { VehicleIdentity, VehiclePlate } from "../src/components/VehiclePlate";
import { closeoutProgress, finishWork, submitDayReport, nextPreviewShiftDate, displayShiftDate, type EndOfDay } from "./end-of-day";
import { previewVehicle } from "./vehicle";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, AppState, Image, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { NavigationContainer, DefaultTheme, StackActions, useIsFocused, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppIcon } from "../src/components/AppIcon";
import { MenuView } from "@expo/ui/community/menu";
import { apiFetch } from "@repo/core/api";
import MapView, { Marker } from "react-native-maps";
import { ParkingPreview } from "./ParkingPreview";
import { CapturePreview } from "./CapturePreview";
import { SESSION_SHADE } from "./scene/session-presentation";
import { VehicleScene } from "./scene/VehicleScene";
import { AuthContext } from "../src/AuthContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SessionSheet } from "./SessionSheet";
import { playRibbonFeedback } from "./haptics";
import { HapticPreferences, useHapticPreferences } from "./HapticPreferences";
import { RibbonControl, CaptureReveal, type RibbonOrigin } from "./RibbonControl";
import { DailyReportForm } from "../src/components/DailyReportForm";
import { ShiftsScreen } from "../src/screens/ShiftsScreen";
import { RewardsScreen } from "../src/screens/RewardsScreen";
import { MeScreen } from "../src/screens/MeScreen";
import { LoginScreen } from "../src/screens/LoginScreen";
import { failNextAuthSave } from "./auth-secure-store";
import { formatDuration } from "../src/format";
import { getStoredDriver, setAuth, setPreviewSession, setPreviewReportFailure, setPreviewNextShift } from "./services";

if (!__DEV__) throw new Error("ネイティブホーム試作は画面確認専用です");

type Purpose = "work" | "move";
type Session = { workDate: string; purpose: Purpose; startedAt: number; fuelRequested: boolean; fueled: boolean };
type MainPage = "ホーム" | "シフト" | "報酬" | "マイページ";
type Routes = { Tabs: undefined; LoginReview: undefined; Notifications: undefined; EndReport: undefined; Settings: undefined; AccountDetails: { section: AccountSection }; Scan: { purpose: Purpose; origin?: RibbonOrigin }; Active: undefined; Finish: { origin?: RibbonOrigin } | undefined; Parking: undefined };
const Stack = createNativeStackNavigator<Routes>();
const mainPages = [{ name: "ホーム", symbol: "house" }, { name: "シフト", symbol: "calendar" }, { name: "報酬", symbol: "yensign" }, { name: "マイページ", symbol: "person.crop.circle" }] as const;
const ink = "#192333";
const parkingMapRegion = { latitude: previewParkingPlace.latitude + .0007, longitude: previewParkingPlace.longitude, latitudeDelta: .0035, longitudeDelta: .006 };
const border = "#DCE3EC";
const surface = "#F6F8FB";
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: "#A96500", background: surface } };
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

type PreviewState = {
  session: Session | null;
  now: number;
  endOfDay: EndOfDay | null;
  nextShift: boolean;
  setNextShift: (value: boolean) => void;
  openReport: () => void;
  reportSubmitted: (date: string) => void;
  openShifts: () => void;
  openNotifications: () => void;
  openLoginReview: () => void;
  tab: MainPage;
  setTab: (value: MainPage) => void;
  off: boolean;
  locationKnown: boolean;
  setLocationKnown: (value: boolean) => void;
  settings: () => void;
  openAccount: (section: AccountSection) => void;
  setOff: (value: boolean) => void;
  scan: (purpose: Purpose, origin?: RibbonOrigin) => void;
  start: (purpose: Purpose, fuelRequested: boolean) => void;
  open: () => void;
  finish: () => void;
  fuel: () => void;
  parking: "pending" | "located" | "unlocated" | null;
  openParking: () => void;
  saveParking: (located: boolean) => void;
};
const Context = createContext<PreviewState | null>(null);
function usePreview() {
  const value = useContext(Context);
  if (!value) throw new Error("NativeHomePreview provider required");
  return value;
}

function Action({ children, onPress, tone = "plain", testID }: { children: ReactNode; onPress: () => void; tone?: "plain" | "danger"; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={{
    minHeight: 52, padding: 15, borderRadius: 16, borderWidth: tone === "plain" ? 1 : 0, borderColor: border,
    backgroundColor: tone === "danger" ? "#E73949" : "#fff", alignItems: "center",
  }}><Text style={{ color: tone === "danger" ? "white" : ink, fontSize: 16, fontWeight: "600" }}>{children}</Text></Pressable>;
}

function MiniBar({ inline = false }: { inline?: boolean }) {
  const { session, now, open } = usePreview();
  if (!session) return null;
  const label = session.purpose === "work" ? "稼働中" : "車両移動中";
  return <Pressable testID="session-mini-bar" accessibilityRole="button"
    accessibilityLabel={`${label}、${formatDuration(now - session.startedAt)}。画面を開く`} onPress={open}
    style={{ flex: 1, minHeight: 48, paddingHorizontal: 16, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 10,
      borderRadius: 22, borderWidth: 1, borderColor: "#FFFFFF24", backgroundColor: "#192B46" }}>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#4AE59B" }} />
    <Image accessible={false} source={require("./scene/assets/mini-vehicle.png")} resizeMode="contain" style={{ width: inline ? 44 : 64, height: inline ? 32 : 44 }} />
    <View style={{ flex: 1, gap: 2 }}><Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>{label}</Text>
      {!inline && <Text style={{ color: "#D7E2F1", fontSize: 12, fontVariant: ["tabular-nums"] }}>{formatDuration(now - session.startedAt)}</Text>}
    </View><AppIcon name="chevron-up" size={15} color="#EAF1FA" iconStyle="solid" />
  </Pressable>;
}

function Home() {
  const { session, now, off, scan, open, parking, openParking, locationKnown, endOfDay, nextShift, openReport, openShifts, setTab } = usePreview();
  const maps = useMapPreferences();
  const completed = endOfDay ? closeoutProgress(endOfDay, parking).complete : false;
  const scroll = useRef<ScrollView>(null);
  const mapRef = useRef<MapView>(null);
  const [dragging, setDragging] = useState(false);
  const lockScroll = (active: boolean) => { scroll.current?.setNativeProps({ scrollEnabled: !active }); setDragging(active); };
  if (off && !session && !endOfDay) return <ScrollView testID="native-home-off" contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingBottom: 36, gap: 18 }}>
    <Text accessibilityRole="header" style={{ color: ink, fontSize: 28, fontWeight: "700" }}>今日はお休み</Text>
    <View testID="off-day-scene" style={{ overflow: "hidden", borderRadius: 22 }}><VehicleScene mode="off" compactHeight={380} /></View>
    <View style={{ borderTopWidth: 1, borderColor: border, paddingTop: 17, gap: 6 }}>
      <Text style={{ color: "#526074", fontSize: 13, fontWeight: "600" }}>次の稼働</Text>
      <Pressable testID="off-next-shift" accessibilityRole="button" onPress={openShifts} style={{ minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ color: ink, flex: 1, fontSize: 23, fontWeight: "700" }}>{nextShift ? displayShiftDate(nextPreviewShiftDate(today())) : "予定なし"}</Text><AppIcon name="chevron-right" size={15} color="#526074" /></Pressable>
      {nextShift && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}><CourseLabel name={previewHomeCourse.name} /><Text style={{ color: ink, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] }}>7:30</Text></View>}
    </View>
    <Pressable testID="off-rewards" accessibilityRole="button" onPress={() => setTab("報酬")} style={{ minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: "#526074", fontSize: 14, fontWeight: "600" }}>報酬を見る</Text><AppIcon name="chevron-right" size={12} color="#526074" /></Pressable>
    <Pressable testID="off-extra-work" accessibilityRole="button" onPress={() => scan("work")} style={{ minHeight: 48, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ color: "#526074", fontSize: 14, fontWeight: "600" }}>臨時で稼働</Text><AppIcon name="chevron-right" size={12} color="#526074" />
    </Pressable>
  </ScrollView>;
  return <ScrollView ref={scroll} testID="native-home" scrollEnabled={!dragging} bounces={!dragging} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 16 }}>
    {!session && endOfDay ? <View testID="end-of-day-home" style={{ gap: 24, paddingTop: 36, paddingBottom: 20 }}>
      {completed && <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#E4F3EC", alignItems: "center", justifyContent: "center" }}><AppIcon name="check" size={27} color="#287958" /></View>}
      <View style={{ gap: 10 }}><Text accessibilityRole="header" style={{ color: ink, fontSize: 28, fontWeight: "700" }}>{completed ? "お疲れ様でした" : "終了の手続き"}</Text>
        <Text style={{ color: "#526074", fontSize: 15 }}>{completed ? "今日の手続きは完了です" : "稼働は終了しました"}</Text></View>
      {!completed ? <CloseoutSummary day={endOfDay} parking={parking} onReport={openReport} onParking={openParking} />
        : <View style={{ padding: 22, gap: 12, backgroundColor: "white", borderRadius: 22 }}><Text style={{ color: "#526074", fontSize: 13 }}>次の稼働</Text><Text style={{ color: ink, fontSize: 23, fontWeight: "600" }}>{nextShift ? displayShiftDate(nextPreviewShiftDate(endOfDay.finishedOn)) : "まだ予定はありません"}</Text><Pressable accessibilityRole="button" onPress={openShifts} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ color: "#526074", fontSize: 15 }}>シフトを確認</Text><AppIcon name="chevron-right" size={12} color="#526074" /></Pressable></View>}
      {completed && parking === "unlocated" && <Text style={{ color: "#526074", fontSize: 13 }}>駐車写真は送信済みです。位置は運営が確認します。</Text>}
    </View> : <>
    {session ? <Text style={{ fontSize: 26, fontWeight: "700", color: ink }}>{session.purpose === "work" ? "稼働中" : "車両移動中"}</Text> : <View style={{ gap: 7, paddingBottom: 5 }}>
      <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: "700", color: ink }}>{homeGreeting(now)}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Text style={{ color: "#64748B", fontSize: 12, fontWeight: "600" }}>本日の担当</Text><CourseLabel name={previewHomeCourse.name} /></View>
    </View>}
    {(!off || session) && <View testID="assigned-vehicle" style={{ backgroundColor: "white", borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: border }}>
      {!session && <View style={{ height: 320, backgroundColor: "#DBE7D8", overflow: "hidden" }}>
        {locationKnown && (parking === null || parking === "located")
          ? <MapView ref={mapRef} style={{ width: "100%", height: "100%" }} mapType="standard" initialRegion={parkingMapRegion} scrollEnabled zoomEnabled rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false} showsUserLocation={false} onTouchStart={() => lockScroll(true)} onTouchEnd={() => lockScroll(false)} onTouchCancel={() => lockScroll(false)}>
              <Marker coordinate={{ latitude: previewParkingPlace.latitude, longitude: previewParkingPlace.longitude }} anchor={{ x: .5, y: .98 }} title={`${previewVehicle.number_prefix} ${previewVehicle.number_class} ${previewVehicle.number_hiragana} ${previewVehicle.number_numeric}`} description={`${previewParkingPlace.name}に駐車中`} tracksViewChanges={false}>
                <View style={{ alignItems: "center" }}>
                  <View style={{ backgroundColor: "white", borderRadius: 11, paddingHorizontal: 11, paddingVertical: 7, alignItems: "center", gap: 2, shadowColor: "#192333", shadowOffset: { width: 0, height: 2 }, shadowOpacity: .16, shadowRadius: 5 }}>
                    <VehiclePlate vehicle={previewVehicle} width={94} />
                    <Text style={{ color: ink, fontSize: 11, fontWeight: "600" }}>{previewParkingPlace.name}<Text style={{ color: "#526074", fontSize: 10, fontWeight: "400" }}> に駐車中</Text></Text>
                  </View>
                  <View style={{ width: 8, height: 8, backgroundColor: "white", transform: [{ rotate: "45deg" }], marginTop: -4, marginBottom: -1 }} />
                  <Image source={require("./scene/assets/map-vehicle.png")} resizeMode="contain" style={{ width: 76, height: 51 }} />
                </View>
              </Marker>
            </MapView>
          : <View style={{ width: "100%", height: "100%", backgroundColor: "#E8ECF0" }} />}
        {locationKnown && (parking === null || parking === "located") && <>
          <Pressable accessibilityRole="button" accessibilityLabel="駐車場所を地図の中心へ戻す" onPress={() => mapRef.current?.animateToRegion(parkingMapRegion, 300)} style={{ position: "absolute", top: 9, right: 9, width: 34, height: 34, borderRadius: 17, backgroundColor: "#FFFFFFEE", alignItems: "center", justifyContent: "center" }}><AppIcon name="crosshairs" size={15} color="#355779" iconStyle="solid" /></Pressable>
        </>}
      </View>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        {(!locationKnown || (parking !== null && parking !== "located") || !!session) ? <View style={{ flex: 1, minWidth: 0 }}><VehicleScene mode="idle" compactHeight={112} /></View> : <Text style={{ flex: 1, color: ink, fontSize: 18, fontWeight: "700" }}>エブリイ</Text>}
        {(!locationKnown || (parking !== null && parking !== "located") || !!session) ? <VehicleIdentity vehicle={previewVehicle} width={128} /> : <VehiclePlate vehicle={previewVehicle} width={128} />}
      </View>
      {!session && <Pressable testID="open-parking-map" accessibilityRole={locationKnown && (parking === null || parking === "located") ? "button" : undefined} accessibilityLabel="駐車場所を地図で開く" disabled={maps.pending || !locationKnown || (parking !== null && parking !== "located")} onPress={() => { void maps.openMap(previewParkingPlace); }} style={{ borderTopWidth: 1, borderColor: border, paddingHorizontal: 16, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 11 }}>
        <AppIcon name="location-dot" size={19} color="#355779" iconStyle="solid" />
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: ink, fontSize: 16, fontWeight: "700" }}>{locationKnown && (parking === null || parking === "located") ? previewParkingPlace.name : "位置を確認中"}</Text><Text style={{ color: "#526074", fontSize: 11 }}>{locationKnown && (parking === null || parking === "located") ? previewParkingPlace.address : "運営に駐車場所を確認してください"}</Text></View>
        {locationKnown && (parking === null || parking === "located") && <AppIcon name="chevron-right" size={13} color="#526074" />}
      </Pressable>}
    </View>}
    {!!maps.error && <Text accessibilityRole="alert" style={{ color: "#B91C1C" }}>{maps.error}</Text>}
    {!session && parking === "pending" && <View style={{ gap: 8 }}><Text style={{ color: "#526074", fontSize: 12 }}>確認用：駐車候補の通知</Text><Action testID="parking-notice" onPress={openParking}>駐車を完了しましたか？</Action></View>}
    {!session && parking && parking !== "pending" && <Text style={{ color: "#526074" }}>{parking === "located" ? "駐車写真と場所を記録しました（架空）" : "駐車写真を記録しました。位置は未確定です（架空）"}</Text>}
    {session ? <><Action onPress={open}>進行中の画面を開く</Action>{session.purpose === "work" && <Action testID="working-report" onPress={openReport}>日報を書く・修正する</Action>}</> : <RibbonControl mode="start" onInteractionChange={lockScroll} onOpen={origin => scan("work", origin)} />}
    </>}
  </ScrollView>;
}

function EndReport() {
  const { endOfDay, session, reportSubmitted } = usePreview();
  const [failure, setFailure] = useState(false);
  useEffect(() => { setPreviewReportFailure(failure); return () => setPreviewReportFailure(false); }, [failure]);
  const reportDate = session?.purpose === "work" ? session.workDate : endOfDay?.workDate;
  if (!reportDate) return null;
  return <ScrollView testID="end-report" contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
    <Text style={{ color: "#526074", fontSize: 14 }}>{displayShiftDate(reportDate)}</Text>
    <DailyReportForm confirmedVehicle={previewVehicle} date={reportDate} showSubmitButton onSubmitted={() => reportSubmitted(reportDate)} />
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24 }}><Text style={{ color: "#526074", fontSize: 12 }}>確認用：日報の送信エラー</Text><Switch accessibilityLabel="確認用：日報の送信エラー" value={failure} onValueChange={setFailure} /></View>
  </ScrollView>;
}

function Tabs() {
  const { tab, setTab, session, openNotifications, openLoginReview } = usePreview();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!focused) return;
    let active = true;
    void apiFetch<{ unreadCount: number }>("/api/me/notifications").then(result => { if (active) setUnreadCount(result.unreadCount ?? 0); }).catch(() => {});
    return () => { active = false; };
  }, [focused]);
  return <View style={{ flex: 1, backgroundColor: surface }}>
    <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: surface }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Image accessible={false} source={require("../assets/logo-icon.png")} resizeMode="contain" style={{ width: 42, height: 42, borderRadius: 8 }} /><Text accessibilityRole="header" style={{ color: ink, fontSize: 23, fontWeight: "800" }}>ハコ虎</Text></View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Pressable testID="open-notifications" accessibilityRole="button" accessibilityLabel={unreadCount > 0 ? `通知、未読${unreadCount}件` : "通知"} onPress={openNotifications} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <AppIcon name="bell" size={22} color={ink} />
          {unreadCount > 0 && <View style={{ position: "absolute", top: 6, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: "#D64545" }} />}
        </Pressable>
        <MenuView testID="open-main-menu" actions={[...mainPages.map(page => ({ id: page.name, title: page.name, image: Platform.OS === "ios" ? page.symbol : undefined, state: tab === page.name ? "on" as const : "off" as const })), { id: "login-review", title: "ログイン確認" }]} onPressAction={event => { if (event.nativeEvent.event === "login-review") { openLoginReview(); return; } const selected = mainPages.find(page => page.name === event.nativeEvent.event); if (selected) setTab(selected.name); }}>
          <View accessible accessibilityRole="button" accessibilityLabel="メニューを開く" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><AppIcon name="bars" size={23} color={ink} /></View>
        </MenuView>
      </View>
    </View>
    <View style={{ flex: 1, backgroundColor: surface }}>{tab === "ホーム" ? <Home /> : tab === "シフト" ? <ShiftsScreen /> : tab === "報酬" ? <RewardsScreen /> : <MyPage />}</View>
    {session && <View style={{ backgroundColor: surface, height: 78, paddingHorizontal: 12, paddingVertical: 5 }}><MiniBar /></View>}
  </View>;
}

function LoginReview({ navigation }: NativeStackScreenProps<Routes, "LoginReview">) {
  const [armed, setArmed] = useState(false);
  return <View style={{ flex: 1, backgroundColor: surface }}>
    <Pressable testID="fail-next-auth-save" accessibilityRole="button" onPress={() => { failNextAuthSave(); setArmed(true); }} style={{ minHeight: 44, paddingHorizontal: 20, justifyContent: "center", backgroundColor: "#FFF7DD" }}>
      <Text style={{ color: ink, fontSize: 13 }}>{armed ? "次の端末保存は失敗します" : "次の端末保存を失敗させる"}</Text>
    </Pressable>
    <LoginScreen onLoggedIn={() => navigation.goBack()} />
  </View>;
}

function Scan({ route, navigation }: NativeStackScreenProps<Routes, "Scan">) {
  const { start } = usePreview();
  return <CaptureReveal origin={route.params.origin}><CapturePreview target="in" purpose={route.params.purpose} onComplete={fuel => start(route.params.purpose, fuel)} onCancel={() => navigation.goBack()} /></CaptureReveal>;
}

function Active({ navigation }: NativeStackScreenProps<Routes, "Active">) {
  const { session, now, fuel, openReport } = usePreview();
  const insets = useSafeAreaInsets();
  const [presented, setPresented] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const [dragging, setDragging] = useState(false), [sheetDragging, setSheetDragging] = useState(false);
  const ribbonActive = useRef(false), scrollOffset = useRef(0);
  const lockScroll = (active: boolean) => { ribbonActive.current = active; scroll.current?.setNativeProps({ scrollEnabled: !active }); setDragging(active); };
  const lockForSheet = (active: boolean) => { scroll.current?.setNativeProps({ scrollEnabled: !active && !ribbonActive.current }); setSheetDragging(active); };
  const [height, setHeight] = useState(0);
  useEffect(() => {
    // GLViewはUIKitのシート再配置が終わってから生成する。
    const cancel = navigation.addListener("transitionEnd", event => { if (!event.data.closing) setPresented(true); });
    return cancel;
  }, [navigation]);
  if (!session) return null;
  return <SessionSheet top={insets.top + 12} ribbonActive={ribbonActive} scrollOffset={scrollOffset} onClose={() => navigation.goBack()} onHeight={setHeight} onDragging={lockForSheet}>
    <VehicleScene mode={session.purpose === "work" ? "working" : "moving"} immersive presented={presented}>
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, experimental_backgroundImage: SESSION_SHADE }} />
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 }}><Pressable testID="session-drag-handle" accessibilityRole="button" accessibilityLabel="稼働・移動の画面を閉じる" onPress={() => navigation.goBack()} style={{ height: 44, alignItems: "center", justifyContent: "center" }}><View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: "#FFFFFF88" }} /></Pressable></View>
      <ScrollView ref={scroll} testID="session-scroll" scrollEnabled={!dragging && !sheetDragging} bounces={false} scrollEventThrottle={16} onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ minHeight: height, paddingHorizontal: 24, paddingTop: 44, paddingBottom: Math.max(24, insets.bottom), gap: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#4AE59B" }} />
          <Text style={{ flex: 1, color: "white", fontSize: 28, fontWeight: "700" }}>{session.purpose === "work" ? "稼働中" : "車両移動中"}</Text>
          <Pressable testID="collapse-session" accessibilityRole="button" accessibilityLabel="稼働・移動の画面を閉じる" onPress={() => navigation.goBack()} style={{ padding: 12, minWidth: 44, minHeight: 44 }}>
            <AppIcon name="chevron-down" size={20} color="#fff" iconStyle="solid" />
          </Pressable>
        </View>
        <Text style={{ color: "#E6EFFA", fontSize: 15, marginTop: -14 }}>{formatDuration(now - session.startedAt)}</Text>
        <View pointerEvents="none" style={{ flex: 1, minHeight: 200 }} />
        <View style={{ padding: 17, borderRadius: 20, borderWidth: 1, borderColor: "#FFFFFF26", backgroundColor: "#14263ACC", flexDirection: "row", alignItems: "center", gap: 16 }}>
          <AppIcon name="car-side" size={25} color="#fff" iconStyle="solid" />
          <View style={{ flex: 1, gap: 4 }}><Text style={{ color: "#C6D4E5", fontSize: 12 }}>使用車両</Text><VehicleIdentity vehicle={previewVehicle} light /></View>
        </View>
        {session.purpose === "move" && <View style={{ gap: 12 }}>
          <Text style={{ color: "white", fontSize: 16 }}>届け先　中央車庫</Text>
          {session.fuelRequested && <Text style={{ color: "white", fontSize: 16 }}>{session.fueled ? "給油済み" : "給油の依頼あり"}</Text>}
          {!session.fueled && <Action testID="record-preview-fuel" onPress={() => Alert.alert("給油の記録", "架空の給油を記録します。", [{ text: "戻る", style: "cancel" }, { text: "記録", onPress: fuel }])}>給油を記録</Action>}
        </View>}
        {session.purpose === "work" ? <RibbonControl mode="end" onInteractionChange={lockScroll} onOpen={origin => navigation.navigate("Finish", { origin })} />
          : <Action testID="end-preview-move" tone="danger" onPress={() => navigation.navigate("Finish")}>移動終了</Action>}
        {session.purpose === "work" && <Action testID="active-report" onPress={openReport}>日報を書く・修正する</Action>}
      </ScrollView>
    </VehicleScene>
  </SessionSheet>;
}

function Finish({ route, navigation }: NativeStackScreenProps<Routes, "Finish">) {
  const { session, finish } = usePreview();
  if (!session) return null;
  return <CaptureReveal origin={route.params?.origin}><CapturePreview target="out" purpose={session.purpose} onComplete={finish} onCancel={() => navigation.goBack()} /></CaptureReveal>;
}

function Parking({ navigation }: NativeStackScreenProps<Routes, "Parking">) {
  const { saveParking } = usePreview();
  return <ParkingPreview onSaved={saveParking} onLater={() => navigation.goBack()} />;
}

function MyPage() {
  const { settings, openAccount } = usePreview();
  const active = useIsFocused();
  return <MeScreen active={active} onOpen={openAccount} onAppSettings={settings} />;
}
function Settings() {
  const maps = useMapPreferences();
  const { off, setOff, locationKnown, setLocationKnown, nextShift, setNextShift } = usePreview();
  const { enabled, pending, error, setEnabled } = useHapticPreferences();
  const [testError, setTestError] = useState("");
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 20 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ fontSize: 16, color: ink }}>スライドの振動</Text><Switch testID="haptics-setting" accessibilityLabel="スライドの振動" value={enabled} disabled={pending} onValueChange={setEnabled} /></View>
    {([['tick', '動き始めを試す'], ['release', '確定を試す']] as const).map(([kind, label]) => <Pressable key={kind} testID={`test-haptics-${kind}`} accessibilityRole="button" disabled={!enabled || pending} onPress={() => { setTestError(""); void playRibbonFeedback(kind).catch(() => setTestError("振動を開始できませんでした。アプリを開き直してください。")); }} style={{ minHeight: 44, justifyContent: "center", opacity: enabled && !pending ? 1 : .4 }}><Text style={{ color: "#526074", fontSize: 15 }}>{label}</Text></Pressable>)}
    <View style={{ gap: 8 }}><Text style={{ color: ink, fontSize: 16, fontWeight: "600" }}>地図アプリ</Text>
      {mapApps.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: maps.app === option.value, disabled: maps.pending }} disabled={maps.pending} onPress={() => maps.setApp(option.value)} style={{ minHeight: 52, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: border, flexDirection: "row", justifyContent: "space-between", backgroundColor: maps.app === option.value ? "#FFF7DD" : "white" }}><Text style={{ color: ink, fontSize: 16 }}>{option.label}</Text>{maps.app === option.value && <AppIcon name="check" size={17} color={ink} />}</Pressable>)}
      <Text style={{ color: "#526074", fontSize: 13 }}>未インストールの場合はブラウザで開きます。</Text>
      {!!maps.error && <Text accessibilityRole="alert" style={{ color: "#B91C1C" }}>{maps.error}</Text>}
    </View>
    {!!testError && <Text accessibilityRole="alert" style={{ color: "#B91C1C" }}>{testError}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: "#B91C1C" }}>{error}</Text>}
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: ink }}>確認用：次の稼働予定あり</Text><Switch accessibilityLabel="確認用：次の稼働予定あり" value={nextShift} onValueChange={setNextShift} /></View>
    <Text style={{ marginTop: 20, fontSize: 13, color: "#526074" }}>画面確認</Text>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: ink }}>駐車位置が確定</Text><Switch accessibilityLabel="確認用：駐車位置が確定" value={locationKnown} onValueChange={setLocationKnown} /></View>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: ink }}>今日は休み</Text><Switch accessibilityLabel="確認用：今日は休み" value={off} onValueChange={setOff} /></View>
  </ScrollView>;
}

export default function NativeHomePreview() {
  return <HapticPreferences><MapPreferences><NativeHomeContent /></MapPreferences></HapticPreferences>;
}
function NativeHomeContent() {
  const navigation = useNavigationContainerRef<Routes>();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<MainPage>("ホーム");
  const [off, setOff] = useState(false);
  const [endOfDay, setEndOfDay] = useState<EndOfDay | null>(null);
  const [submittedReportDate, setSubmittedReportDate] = useState<string | null>(null);
  const [nextShift, setNextShift] = useState(true);
  useEffect(() => { setPreviewNextShift(nextShift); }, [nextShift]);
  const [locationKnown, setLocationKnown] = useState(true);
  const [parking, setParking] = useState<"pending" | "located" | "unlocated" | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setAuth(); setPreviewSession("idle");
  }, []);
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = (state: string) => {
      clearInterval(timer);
      if (state === "active") { setNow(Date.now()); timer = setInterval(() => setNow(Date.now()), 30_000); }
    };
    update(AppState.currentState);
    const listener = AppState.addEventListener("change", update);
    return () => { clearInterval(timer); listener.remove(); };
  }, [session?.startedAt]);
  const open = () => { if (navigation.isReady()) navigation.navigate("Active"); };
  const start = (purpose: Purpose, fuelRequested: boolean) => {
    if (session) return;
    if (purpose === "work") setEndOfDay(null);
    setPreviewSession(purpose === "move" ? "moving" : "working");
    setParking(null);
    setSession({ workDate: today(), purpose, startedAt: Date.now(), fuelRequested, fueled: false });
    setNow(Date.now());
    navigation.dispatch(StackActions.replace("Active"));
  };
  const finish = () => {
    setPreviewSession(session?.purpose === "work" ? "ended" : "idle");
    setSession(null);
    setParking("pending");
    if (session?.purpose === "work") {
      setEndOfDay(submittedReportDate === session.workDate ? submitDayReport(finishWork(session.workDate, today()), session.workDate) : finishWork(session.workDate, today()));
      setTab("ホーム");
      navigation.reset({ index: 0, routes: [{ name: "Tabs" }] });
    } else navigation.dispatch(StackActions.popToTop());
  };
  const reportSubmitted = (date: string) => {
    setSubmittedReportDate(date);
    if (endOfDay?.workDate === date) setEndOfDay(value => submitDayReport(value, date));
    setTab("ホーム");
    navigation.reset({ index: 0, routes: [{ name: "Tabs" }] });
  };
  return <AuthContext.Provider value={{ driver: getStoredDriver()!, logout: () => Alert.alert("画面確認モード", "端末のログイン情報は変更していません。") }}>
    <Context.Provider value={{ endOfDay, nextShift, setNextShift, reportSubmitted, openReport: () => navigation.navigate("EndReport"), openShifts: () => setTab("シフト"), openNotifications: () => navigation.navigate("Notifications"), openLoginReview: () => navigation.navigate("LoginReview"), tab, setTab, session, now, off, setOff, locationKnown, setLocationKnown, settings: () => navigation.navigate("Settings"), openAccount: section => navigation.navigate("AccountDetails", { section }), open, start, finish, parking,
      openParking: () => navigation.navigate("Parking"),
      saveParking: located => {
        setParking(located ? "located" : "unlocated");
        setTab("ホーム");
        navigation.reset({ index: endOfDay?.report === "pending" ? 1 : 0, routes: [{ name: "Tabs" }, ...(endOfDay?.report === "pending" ? [{ name: "EndReport" as const }] : [])] });
      },
      scan: (purpose, origin) => { if (!session) navigation.navigate("Scan", { purpose, origin }); else open(); },
      fuel: () => setSession(value => value ? { ...value, fueled: true } : null),
    }}>
      <NavigationContainer ref={navigation} theme={theme}>
        <Stack.Navigator initialRouteName="Tabs">
          <Stack.Screen name="LoginReview" component={LoginReview} options={{ title: "ログイン確認", headerBackTitle: "ホーム" }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "通知", headerBackTitle: "ホーム" }} />
          <Stack.Screen name="EndReport" component={EndReport} options={{ title: "日報", headerBackTitle: "ホーム" }} />
          <Stack.Screen name="Settings" component={Settings} options={{ title: "地図・振動", headerBackTitle: "マイページ" }} />
          <Stack.Screen name="AccountDetails" component={AccountDetailScreen} options={({ route }) => ({ title: accountSectionTitles[route.params.section], headerBackTitle: "マイページ" })} />
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="Scan" component={Scan} options={{ headerShown: false, presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
          <Stack.Screen name="Active" component={Active} options={{ headerShown: false, presentation: "transparentModal", animation: "slide_from_bottom", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
          <Stack.Screen name="Parking" component={Parking} options={{ title: "駐車場所", presentation: "modal" }} />
          <Stack.Screen name="Finish" component={Finish} options={{ headerShown: false, presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
        </Stack.Navigator>
      </NavigationContainer>
    </Context.Provider>
  </AuthContext.Provider>;
}
