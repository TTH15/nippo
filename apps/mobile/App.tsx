import "./global.css";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { getStoredDriver, clearAuth, type StoredDriver } from "@repo/core/auth";
import { apiFetch } from "@repo/core/api";
import { bootstrap } from "./src/bootstrap";
import { AuthContext } from "./src/AuthContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { KycWizard } from "./src/screens/KycWizard";
import { KycPending } from "./src/screens/KycPending";
import { MeScreen } from "./src/screens/MeScreen";
import { RewardsScreen } from "./src/screens/RewardsScreen";
import { ShiftsScreen } from "./src/screens/ShiftsScreen";
import { WorkScreen } from "./src/screens/WorkScreen";
import { AdminDailyScreen } from "./src/screens/admin/AdminDailyScreen";
import { AdminSalesScreen } from "./src/screens/admin/AdminSalesScreen";
import { AdminDriversScreen } from "./src/screens/admin/AdminDriversScreen";
import { AdminVehiclesScreen } from "./src/screens/admin/AdminVehiclesScreen";
import { BottomTabBar } from "./src/components/BottomTabBar";
import { ModeSwitchFab } from "./src/components/ModeSwitchFab";

const Tab = createBottomTabNavigator();

export default function App() {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [adminMode, setAdminMode] = useState(false);
  // ハードゲート判定: null=確認中 / {complete=本登録, kycVerified=本承認}
  const [regState, setRegState] = useState<{ complete: boolean; kycVerified: boolean } | null>(null);

  const fetchReg = () => {
    setRegState(null);
    apiFetch<{ complete: boolean; kycVerified: boolean }>("/api/me/registration")
      .then((r) => setRegState({ complete: r.complete, kycVerified: r.kycVerified }))
      .catch(() => setRegState({ complete: true, kycVerified: true })); // 取得失敗時はブロックしない
  };

  useEffect(() => {
    bootstrap(() => setDriver(null))
      .then(() => {
        setDriver(getStoredDriver());
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

  // 未ログイン: ログイン / 仮登録
  if (!driver) {
    return (
      <>
        {authView === "register" ? (
          <RegisterScreen onBack={() => setAuthView("login")} />
        ) : (
          <LoginScreen onLoggedIn={() => setDriver(getStoredDriver())} onRegister={() => setAuthView("register")} />
        )}
        <StatusBar style="auto" />
      </>
    );
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

  // ①本登録が未完了 → ウィザード（完了したら再取得して本人確認待ちへ）。
  if (!regState.complete) {
    return (
      <SafeAreaProvider>
        <AuthContext.Provider value={{ driver, logout: () => { clearAuth(); setDriver(null); } }}>
          <KycWizard onComplete={fetchReg} />
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
        <NavigationContainer>
          {adminMode && canUseAdminMode ? (
            <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <BottomTabBar {...props} />}>
              <Tab.Screen name="日報承認" component={AdminDailyScreen} />
              <Tab.Screen name="売上" component={AdminSalesScreen} />
              <Tab.Screen name="ドライバー" component={AdminDriversScreen} />
              <Tab.Screen name="車両" component={AdminVehiclesScreen} />
            </Tab.Navigator>
          ) : (
            <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <BottomTabBar {...props} />}>
              <Tab.Screen name="マイページ" component={MeScreen} />
              <Tab.Screen name="希望休" component={ShiftsScreen} />
              <Tab.Screen name="業務" component={WorkScreen} />
              <Tab.Screen name="報酬" component={RewardsScreen} />
            </Tab.Navigator>
          )}
        </NavigationContainer>
        {canUseAdminMode && <ModeSwitchFab adminMode={adminMode} onToggle={() => setAdminMode((v) => !v)} />}
      </AuthContext.Provider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f6f7f8" },
});
