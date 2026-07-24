import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View, Text, Pressable, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";

// ============================================================
// 端末ローカルの生体ロック（LINE 的な起動時 FaceID）。§2-1a の「毎日の起動」層。
// 30日セッション（SecureStore）を保持したまま、起動/復帰時に生体でアプリを解錠する。
// サーバー認証（Passkey）とは別レイヤ＝ここは端末内のみ・サーバー往復なし。
// 生体未設定/非対応端末では素通し（締め出さない）。ドメイン/M1 に非依存で今すぐ動く。
// ============================================================

// active: ログイン済みか / lockOnEntry: 起動時に既存セッションを復元したか（コールドスタート）。
// 起動時ロックは lockOnEntry の時だけ＝対話ログイン直後（OTP 認証済み）に FaceID を二重要求しない。
// バックグラウンド→復帰の再ロックは常に有効。
export function useBiometricLock(active: boolean, lockOnEntry: boolean) {
  const [available, setAvailable] = useState(false);
  const [locked, setLocked] = useState(false);
  const appState = useRef(AppState.currentState);

  // 生体の利用可否を一度だけ判定。
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const hw = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (mounted) setAvailable(hw && enrolled);
      } catch {
        if (mounted) setAvailable(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 起動時ロック: コールドスタートで既存セッションを復元した時のみ（対話ログイン直後は除外）。
  // 未ログイン化で解除。
  useEffect(() => {
    if (active && available && lockOnEntry) setLocked(true);
    if (!active) setLocked(false);
  }, [active, available, lockOnEntry]);

  // バックグラウンド→フォアグラウンド復帰で再ロック。
  // "inactive"（FaceID プロンプト表示中の一時状態）からの復帰では再ロックしない＝ループ防止。
  useEffect(() => {
    if (!active || !available) return;
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (prev === "background" && next === "active") setLocked(true);
    });
    return () => sub.remove();
  }, [active, available]);

  const unlock = useCallback(async () => {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "ロックを解除",
        cancelLabel: "キャンセル",
        disableDeviceFallback: false,
      });
      if (res.success) setLocked(false);
    } catch {
      /* キャンセル等は無視（ロック維持） */
    }
  }, []);

  return { locked: active && available && locked, unlock };
}

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  // 表示と同時に一度だけ生体プロンプトを出す。
  useEffect(() => {
    onUnlock();
  }, [onUnlock]);

  return (
    <View style={styles.center}>
      <Text style={styles.title}>ロックされています</Text>
      <Pressable style={styles.button} onPress={onUnlock}>
        <Text style={styles.buttonText}>ロックを解除</Text>
      </Pressable>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f6f7f8", gap: 20 },
  title: { fontSize: 16, color: "#334155", fontWeight: "600" },
  button: { backgroundColor: "#0f172a", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
