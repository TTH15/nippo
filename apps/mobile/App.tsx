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
import { SubmitScreen } from "./src/screens/SubmitScreen";
import { WorkScreen } from "./src/screens/WorkScreen";

const Tab = createBottomTabNavigator();

export default function App() {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");
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
  return (
    <SafeAreaProvider>
      <AuthContext.Provider value={{ driver, logout: () => { clearAuth(); setDriver(null); } }}>
        <NavigationContainer>
          <Tab.Navigator screenOptions={{ headerShown: false }}>
            <Tab.Screen name="業務" component={WorkScreen} />
            <Tab.Screen name="日報" component={SubmitScreen} />
            <Tab.Screen name="希望休" component={ShiftsScreen} />
            <Tab.Screen name="報酬" component={RewardsScreen} />
            <Tab.Screen name="マイページ" component={MeScreen} />
          </Tab.Navigator>
        </NavigationContainer>
      </AuthContext.Provider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f1f5f9" },
});
