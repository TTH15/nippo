import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { Profile } from "@repo/core/types";
import { buildProfileEntries } from "@repo/core/logic/profile";
import { useAuth } from "../AuthContext";

// ============================================================
// マイページ（me）＝プロフィール表示（読み取り専用）。NativeWind。
// 表示ロジックは Web と同じ @repo/core/logic/profile（buildProfileEntries）を再利用。
// PIN 変更・諸報告（書き込み系）は次段。
// ============================================================

export function MeScreen() {
  const { driver, logout } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    return () => {
      alive = false;
    };
  }, []);

  const entries = buildProfileEntries(profile);

  return (
    <ScrollView className="flex-1 bg-slate-100" contentContainerClassName="p-5 pt-16 gap-3">
      <Text className="text-sm text-slate-500">マイページ</Text>
      <Text className="text-[26px] font-bold text-slate-900 mb-2">{profile?.name || driver.name}</Text>

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text className="text-red-600 py-4">{error}</Text>
      ) : (
        <View className="bg-white rounded-[10px] border border-slate-200 overflow-hidden">
          {entries.map((e) => (
            <View key={e.label} className="flex-row justify-between items-center py-3 px-4 gap-3 border-b border-slate-200">
              <Text className="text-[13px] text-slate-500">{e.label}</Text>
              <Text className="text-sm text-slate-900 shrink text-right">{e.value}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable className="mt-4 self-center border border-slate-300 bg-white py-2.5 px-6 rounded-lg active:opacity-80" onPress={logout}>
        <Text className="text-slate-700 font-semibold">ログアウト</Text>
      </Pressable>
    </ScrollView>
  );
}
