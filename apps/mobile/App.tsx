import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { getStoredDriver, clearAuth, type StoredDriver } from "@repo/core/auth";
import { bootstrap } from "./src/bootstrap";
import { AuthContext } from "./src/AuthContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MeScreen } from "./src/screens/MeScreen";
import { RewardsScreen } from "./src/screens/RewardsScreen";

const Tab = createBottomTabNavigator();

export default function App() {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<StoredDriver | null>(null);

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
        <LoginScreen onLoggedIn={() => setDriver(getStoredDriver())} />
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
            <Tab.Screen name="マイページ" component={MeScreen} />
            <Tab.Screen name="報酬" component={RewardsScreen} />
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
