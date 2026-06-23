import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { getStoredDriver, clearAuth, type StoredDriver } from "@repo/core/auth";
import { bootstrap } from "./src/bootstrap";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";

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

  return (
    <>
      {driver ? (
        <HomeScreen
          driver={driver}
          onLogout={() => {
            clearAuth();
            setDriver(null);
          }}
        />
      ) : (
        <LoginScreen onLoggedIn={() => setDriver(getStoredDriver())} />
      )}
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f1f5f9" },
});
