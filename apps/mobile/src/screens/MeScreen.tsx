import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { apiFetch } from "@repo/core/api";
import type { Profile } from "@repo/core/types";
import { buildProfileEntries } from "@repo/core/logic/profile";
import { useAuth } from "../AuthContext";

// ============================================================
// マイページ（me）の RN 移植・第1弾＝プロフィール表示（読み取り専用）。
// 表示ロジックは Web と同じ @repo/core/logic/profile（buildProfileEntries）を再利用。
// PIN 変更・諸報告（書き込み系）は次段（本番 DB を汚さないよう dev 接続後に）。
// ============================================================

export function MeScreen() {
  const { driver, logout } = useAuth();
  const nav = useNavigation<{ navigate: (s: string) => void }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [regComplete, setRegComplete] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<Profile>("/api/reports/profile")
      .then((p) => {
        if (alive) setProfile(p);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "プロフィールの取得に失敗しました");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    // 本登録の完了状態（未完了ならバナー表示）
    apiFetch<{ complete: boolean }>("/api/me/registration")
      .then((r) => {
        if (alive) setRegComplete(r.complete);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const entries = buildProfileEntries(profile);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>マイページ</Text>
      <Text style={styles.name}>{profile?.name || driver.name}</Text>

      {regComplete === false && (
        <Pressable style={styles.banner} onPress={() => nav.navigate("Kyc")}>
          <Text style={styles.bannerTitle}>本登録が未完了です</Text>
          <Text style={styles.bannerMsg}>免許証・顔写真・住所・銀行口座を登録してください ›</Text>
        </Pressable>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <View style={styles.card}>
          {entries.map((e) => (
            <View key={e.label} style={styles.row}>
              <Text style={styles.label}>{e.label}</Text>
              <Text style={styles.value}>{e.value}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>ログアウト</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f1f5f9" },
  content: { padding: 20, paddingTop: 64, gap: 12 },
  title: { fontSize: 14, color: "#64748b" },
  name: { fontSize: 26, fontWeight: "700", color: "#0f172a", marginBottom: 8 },
  banner: { backgroundColor: "#fef3c7", borderWidth: 1, borderColor: "#fcd34d", borderRadius: 10, padding: 14, gap: 2 },
  bannerTitle: { fontSize: 14, fontWeight: "700", color: "#92400e" },
  bannerMsg: { fontSize: 12, color: "#b45309" },
  center: { paddingVertical: 32, alignItems: "center" },
  error: { color: "#dc2626", paddingVertical: 16 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
    gap: 12,
  },
  label: { fontSize: 13, color: "#64748b" },
  value: { fontSize: 14, color: "#0f172a", flexShrink: 1, textAlign: "right" },
  logout: {
    marginTop: 16,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  logoutText: { color: "#334155", fontWeight: "600" },
});
