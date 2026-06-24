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
import { MeScreen } from "./src/screens/MeScreen";
import { RewardsScreen } from "./src/screens/RewardsScreen";
import { ShiftsScreen } from "./src/screens/ShiftsScreen";
import { SubmitScreen } from "./src/screens/SubmitScreen";

const Tab = createBottomTabNavigator();

export default function App() {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  // 本登録の完了状態（ハードゲート）: null=確認中 / false=未完了 / true=完了
  const [regComplete, setRegComplete] = useState<boolean | null>(null);

  useEffect(() => {
    bootstrap(() => setDriver(null))
      .then(() => {
        setDriver(getStoredDriver());
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  // ログイン後に本登録の完了状態を取得（ゲート判定）。
  useEffect(() => {
    if (!driver) {
      setRegComplete(null);
      return;
    }
    let alive = true;
    setRegComplete(null);
    apiFetch<{ complete: boolean }>("/api/me/registration")
      .then((r) => alive && setRegComplete(r.complete))
      .catch(() => alive && setRegComplete(true)); // 取得失敗時はブロックしない
    return () => {
      alive = false;
    };
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

  // ログイン後・本登録の状態確認中
  if (regComplete === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <StatusBar style="auto" />
      </View>
    );
  }

  // ハードゲート: 本登録が未完了ならアプリ本体を開かせず、ウィザードを出す。
  if (!regComplete) {
    return (
      <SafeAreaProvider>
        <AuthContext.Provider value={{ driver, logout: () => { clearAuth(); setDriver(null); } }}>
          <KycWizard onComplete={() => setRegComplete(true)} />
        </AuthContext.Provider>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  // 本登録 完了: アプリ本体（タブ）。
  return (
    <SafeAreaProvider>
      <AuthContext.Provider value={{ driver, logout: () => { clearAuth(); setDriver(null); } }}>
        <NavigationContainer>
          <Tab.Navigator screenOptions={{ headerShown: false }}>
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
