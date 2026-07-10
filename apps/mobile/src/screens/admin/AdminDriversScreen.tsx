import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";

// ============================================================
// 運営モード・ドライバーへ電話（最低限版）。一覧はWeb版 admin/users と同じGET
// （既定 status=active）をそのまま利用。アクティブなドライバーはフル電話番号が
// 返る仕様（Web側コメント準拠・承認待ちのみ下4桁マスク）なので、一覧の値を
// そのままtel:リンクに使う。
// ============================================================

type DriverRow = { id: string; name: string; phone: string | null };

export function AdminDriversScreen() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    apiFetch<{ drivers: DriverRow[] }>("/api/admin/users?limit=100")
      .then((res) => {
        if (alive) setDrivers(res.drivers ?? []);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "取得に失敗しました");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const call = (phone: string | null) => {
    setError("");
    const trimmed = phone?.trim();
    if (!trimmed) {
      setError("電話番号が登録されていません");
      return;
    }
    Linking.openURL(`tel:${trimmed.replace(/[^0-9+]/g, "")}`).catch(() => setError("発信に失敗しました"));
  };

  return (
    <ScrollView className="flex-1 bg-brand-50" contentContainerClassName="px-4 pt-16 pb-10 gap-3">
      <Text className="text-lg font-bold text-brand-900 mb-1">ドライバー</Text>
      {error ? <Text className="text-red-600 text-[13px]">{error}</Text> : null}
      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : drivers.length === 0 ? (
        <Text className="text-brand-500 text-[13px] text-center py-8">ドライバーがいません</Text>
      ) : (
        drivers.map((d) => (
          <View key={d.id} className="bg-white rounded-lg border border-brand-200 p-4 flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-brand-900">{d.name}</Text>
              {d.phone && <Text className="text-[12px] text-brand-400 mt-0.5">{d.phone}</Text>}
            </View>
            <Pressable
              className="w-11 h-11 rounded-full bg-accent-500 items-center justify-center active:opacity-80"
              onPress={() => call(d.phone)}
            >
              <FontAwesome6 name="phone" size={16} color="#15181c" iconStyle="solid" />
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}
