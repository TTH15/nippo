import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { getStoredDriver, clearAuth, type StoredDriver } from "@repo/core/auth";
import { bootstrap } from "./src/bootstrap";
import { AuthContext } from "./src/AuthContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { MeScreen } from "./src/screens/MeScreen";
import { KycScreen } from "./src/screens/KycScreen";
import { RewardsScreen } from "./src/screens/RewardsScreen";
import { ShiftsScreen } from "./src/screens/ShiftsScreen";
import { SubmitScreen } from "./src/screens/SubmitScreen";

const Tab = createBottomTabNavigator();
const MeStackNav = createNativeStackNavigator();

function MeStack() {
  return (
    <MeStackNav.Navigator screenOptions={{ headerShown: false }}>
      <MeStackNav.Screen name="MeHome" component={MeScreen} />
      <MeStackNav.Screen name="Kyc" component={KycScreen} />
    </MeStackNav.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  const [authView, setAuthView] = useState<"login" | "register">("login");

  useEffect(() => {
    // 起動時に core へ依存注入し、保存済みログインを復元する。
    // onUnauthorized（401）はログイン画面へ戻す。
    bootstrap(() => setDriver(null))
      .then(() => {
        setDriver(getStoredDriver());
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (!driver) {
    return (
      <>
        {authView === "register" ? (
          <RegisterScreen onBack={() => setAuthView("login")} />
        ) : (
          <LoginScreen
            onLoggedIn={() => setDriver(getStoredDriver())}
            onRegister={() => setAuthView("register")}
          />
        )}
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthContext.Provider
        value={{
          driver,
          logout: () => {
            clearAuth();
            setDriver(null);
          },
        }}
      >
        <NavigationContainer>
          <Tab.Navigator screenOptions={{ headerShown: false }}>
            <Tab.Screen name="日報" component={SubmitScreen} />
            <Tab.Screen name="希望休" component={ShiftsScreen} />
            <Tab.Screen name="報酬" component={RewardsScreen} />
            <Tab.Screen name="マイページ" component={MeStack} />
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
