import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import { formatYen } from "@repo/core/logic/reward";
import { toLocalDateStr } from "@repo/core/logic/calendar";

// ============================================================
// 運営モード・売上ぱっと確認（最低限版）: 本日と今月の売上合計だけを表示する。
// Web版 admin/sales と同じAPIをそのまま利用し、日別バケットを自前で合算する。
// ============================================================

type SalesDay = { iso: string; yamato: number; amazon: number; other: number };

export function AdminSalesScreen() {
  const [days, setDays] = useState<SalesDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const end = toLocalDateStr(now);
    apiFetch<{ data: SalesDay[] }>(`/api/admin/sales?start=${start}&end=${end}`)
      .then((res) => {
        if (alive) setDays(res.data ?? []);
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

  const todayStr = toLocalDateStr(new Date());
  const dayTotal = (d: SalesDay) => d.yamato + d.amazon + d.other;
  const monthTotal = days.reduce((s, d) => s + dayTotal(d), 0);
  const today = days.find((d) => d.iso === todayStr);
  const todayTotal = today ? dayTotal(today) : 0;

  return (
    <ScrollView className="flex-1 bg-brand-50" contentContainerClassName="px-4 pt-16 pb-10 gap-4">
      <Text className="text-lg font-bold text-brand-900">売上</Text>
      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text className="text-red-600 text-[13px]">{error}</Text>
      ) : (
        <>
          <View className="bg-white rounded-lg border border-brand-200 shadow-sm p-5">
            <Text className="text-[13px] text-brand-500 mb-1">本日の売上</Text>
            <Text className="text-3xl font-bold text-brand-900">{formatYen(todayTotal)}</Text>
          </View>
          <View className="bg-white rounded-lg border border-brand-200 p-5">
            <Text className="text-[13px] text-brand-500 mb-1">今月の売上（暫定）</Text>
            <Text className="text-2xl font-bold text-brand-900">{formatYen(monthTotal)}</Text>
          </View>
          {today && (
            <View className="bg-white rounded-lg border border-brand-200 p-4 gap-2">
              <Text className="text-sm font-semibold text-brand-800 mb-1">本日の内訳</Text>
              <View className="flex-row justify-between">
                <Text className="text-[13px] text-brand-500">ヤマト運輸</Text>
                <Text className="text-[13px] text-brand-900 font-medium">{formatYen(today.yamato)}</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-[13px] text-brand-500">Amazon</Text>
                <Text className="text-[13px] text-brand-900 font-medium">{formatYen(today.amazon)}</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-[13px] text-brand-500">その他</Text>
                <Text className="text-[13px] text-brand-900 font-medium">{formatYen(today.other)}</Text>
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
