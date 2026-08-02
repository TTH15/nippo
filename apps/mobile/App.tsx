import "./global.css";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { getStoredDriver, clearAuth, type StoredDriver } from "@repo/core/auth";
import { apiFetch } from "@repo/core/api";
import { bootstrap } from "./src/bootstrap";
import { AuthContext } from "./src/AuthContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { WebRegisterNotice } from "./src/screens/WebRegisterNotice";
import { KycPending } from "./src/screens/KycPending";
import { useBiometricLock, LockScreen } from "./src/components/BiometricLock";
import { MeScreen } from "./src/screens/MeScreen";
import { RewardsScreen } from "./src/screens/RewardsScreen";
import { ShiftsScreen } from "./src/screens/ShiftsScreen";
import { WorkScreen } from "./src/screens/WorkScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { AdminDailyScreen } from "./src/screens/admin/AdminDailyScreen";
import { AdminSalesScreen } from "./src/screens/admin/AdminSalesScreen";
import { AdminDriversScreen } from "./src/screens/admin/AdminDriversScreen";
import { AdminVehiclesScreen } from "./src/screens/admin/AdminVehiclesScreen";
import { BottomTabBar } from "./src/components/BottomTabBar";
import { ModeSwitchFab } from "./src/components/ModeSwitchFab";
import { WorkSessionProvider } from "./src/WorkSessionContext";
import { WorkingMiniBar } from "./src/components/WorkingMiniBar";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

export default function App() {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  // ハードゲート判定: null=確認中 / {complete=本登録, kycVerified=本承認}
  const [regState, setRegState] = useState<{ complete: boolean; kycVerified: boolean } | null>(null);
  // コールドスタートで既存セッションを復元したか（＝起動時に生体ロックを掛ける対象）。
  const [restoredSession, setRestoredSession] = useState(false);
  // 端末ローカルの生体ロック（毎日の起動＝LINE 的 FaceID）。生体設定のある端末のみ発動。
  const { locked, unlock } = useBiometricLock(!!driver, restoredSession);
  // 現在のルート名（稼働中ミニバーの表示判定: ホーム以外のスタック画面でのみ出す）。
  const navRef = useNavigationContainerRef<Record<string, object | undefined>>();
  const [routeName, setRouteName] = useState<string | undefined>(undefined);

  const fetchReg = () => {
    setRegState(null);
    apiFetch<{ complete: boolean; kycVerified: boolean }>("/api/me/registration")
      .then((r) => setRegState({ complete: r.complete, kycVerified: r.kycVerified }))
      .catch(() => setRegState({ complete: true, kycVerified: true })); // 取得失敗時はブロックしない
  };

  useEffect(() => {
    bootstrap(() => setDriver(null))
      .then(() => {
        const restored = getStoredDriver();
        setDriver(restored);
        setRestoredSession(!!restored); // 起動時にセッションがあれば生体ロック対象
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  // ログイン後にゲート状態を取得。
  useEffect(() => {
    if (!driver) {
      setRegState(null);
      return;
    }
    fetchReg();
  }, [driver]);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <StatusBar style="auto" />
      </View>
    );
  }

  // 未ログイン: ログイン（電話OTP 主 / PIN 副）。参加申請・本登録は web 一本化。
  if (!driver) {
    return (
      <>
        <LoginScreen onLoggedIn={() => setDriver(getStoredDriver())} />
        <StatusBar style="auto" />
      </>
    );
  }

  // ログイン済み: 端末ローカルの生体ロック（生体設定のある端末のみ）。
  if (locked) {
    return <LockScreen onUnlock={unlock} />;
  }

  // ログイン後・ゲート状態確認中
  if (regState === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <StatusBar style="auto" />
      </View>
    );
  }

  // ①本登録が未完了 → web で本登録を促す案内（アプリ内 KYC は退役・web 一本化）。
  if (!regState.complete) {
    return (
      <SafeAreaProvider>
        <AuthContext.Provider value={{ driver, logout: () => { clearAuth(); setDriver(null); } }}>
          <WebRegisterNotice onRefresh={fetchReg} />
        </AuthContext.Provider>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  // ②本登録済・本承認前 → 本人確認待ち（アプリ本体は開かない）。
  if (!regState.kycVerified) {
    return (
      <SafeAreaProvider>
        <AuthContext.Provider value={{ driver, logout: () => { clearAuth(); setDriver(null); } }}>
          <KycPending onRefresh={fetchReg} />
        </AuthContext.Provider>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  // ③本承認済 → アプリ本体（タブ）。
  // 運営capabilityを1つでも持つアカウントは、フローティングボタンでドライバー画面⇄
  // 運営モード（最低限機能）を切り替えられる。画面構成の刷新はM-D統合時に行う。
  const canUseAdminMode = (driver.capabilities?.length ?? 0) > 0;

  return (
    <SafeAreaProvider>
      <AuthContext.Provider value={{ driver, logout: () => { clearAuth(); setDriver(null); } }}>
        <WorkSessionProvider>
          <NavigationContainer
            ref={navRef}
            onReady={() => setRouteName(navRef.getCurrentRoute()?.name)}
            onStateChange={() => setRouteName(navRef.getCurrentRoute()?.name)}
          >
            {adminMode && canUseAdminMode ? (
              <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <BottomTabBar {...props} />}>
                <Tab.Screen name="日報承認" component={AdminDailyScreen} />
                <Tab.Screen name="売上" component={AdminSalesScreen} />
                <Tab.Screen name="ドライバー" component={AdminDriversScreen} />
                <Tab.Screen name="車両" component={AdminVehiclesScreen} />
              </Tab.Navigator>
            ) : (
              // ドライバーモードはタブレスの1画面構成: ホーム（業務）を軸に、
              // シフト・報酬・通知・マイページはカード/アイコンからスタック遷移で開く。
              <Stack.Navigator screenOptions={{ headerBackTitle: "戻る" }}>
                <Stack.Screen name="ホーム" component={WorkScreen} options={{ headerShown: false }} />
                <Stack.Screen name="シフト" component={ShiftsScreen} />
                <Stack.Screen name="報酬" component={RewardsScreen} />
                <Stack.Screen name="通知" component={NotificationsScreen} />
                <Stack.Screen name="マイページ" component={MeScreen} />
              </Stack.Navigator>
            )}
          </NavigationContainer>
          {/* 稼働中ミニバー（Spotify 型業務中モード）: ドライバーモードのホーム以外で表示 */}
          {!adminMode && routeName !== undefined && routeName !== "ホーム" && (
            <WorkingMiniBar onPress={() => navRef.isReady() && navRef.navigate("ホーム")} />
          )}
          {canUseAdminMode && <ModeSwitchFab adminMode={adminMode} onToggle={() => setAdminMode((v) => !v)} />}
        </WorkSessionProvider>
      </AuthContext.Provider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f6f7f8" },
});
