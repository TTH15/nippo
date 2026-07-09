import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { Profile } from "@repo/core/types";
import { buildProfileEntries } from "@repo/core/logic/profile";
import { useAuth } from "../AuthContext";

// ============================================================
// マイページ（me）＝プロフィール表示（読み取り専用）。NativeWind。
// 表示ロジックは Web と同じ @repo/core/logic/profile（buildProfileEntries）を再利用。
// PIN 変更・電話番号確認・諸報告（書き込み系）は次段（M4）。
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
    <ScrollView className="flex-1 bg-white" contentContainerClassName="px-4 pt-16 pb-10">
      <Text className="text-lg font-bold text-brand-900 mb-6">マイページ</Text>

      <Text className="text-base font-bold text-brand-900 mb-3">プロフィール</Text>
      {loading ? (
        <View className="bg-white rounded-lg border border-brand-200 p-4 items-center py-8">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text className="text-red-600 text-sm">{error}</Text>
      ) : entries.length === 0 ? (
        <Text className="text-brand-500 text-sm">登録内容はありません</Text>
      ) : (
        <View className="bg-white rounded-lg border border-brand-200 divide-y divide-brand-100">
          {entries.map((e) => (
            <View key={e.label} className="px-4 py-3 gap-1">
              <Text className="text-[13px] font-medium text-brand-500">{e.label}</Text>
              <Text className="text-sm text-brand-900">{e.value}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        className="mt-10 self-center border border-brand-200 bg-white py-2.5 px-6 rounded-lg active:opacity-80"
        onPress={logout}
      >
        <Text className="text-brand-700 font-medium">ログアウト</Text>
      </Pressable>
    </ScrollView>
  );
}
