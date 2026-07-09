import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { RewardsSummary } from "@repo/core/types";
import { nowYearMonth1, formatYearMonth, formatMonthDayJP } from "@repo/core/logic/calendar";
import { mergedDetails, logLabel, formatYen } from "@repo/core/logic/reward";

// ============================================================
// 報酬（me/rewards）＝月次サマリ＋明細（読み取り専用）。NativeWind。
// 計算・整形は Web と同じ @repo/core/logic/reward・calendar を再利用。
// カードの見た目は Web の PaymentSummary/FixedExpenseSection を踏襲。
// ただし合計金額は Web の PaymentSummary のローカル再計算（variableDeductions を
// 含めない）ではなく、サーバ算出の data.net をそのまま使う（金額表示の正確性を優先）。
// 請求書の表示・承認、任意経費の追加・削除（書き込み系）は次段（M4）。
// ============================================================

export function RewardsScreen() {
  const [ym, setYm] = useState(nowYearMonth1);
  const [data, setData] = useState<RewardsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    apiFetch<RewardsSummary>(`/api/me/rewards?month=${formatYearMonth(ym.year, ym.month)}`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "報酬の取得に失敗しました");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ym.year, ym.month]);

  const shiftMonth = (delta: number) =>
    setYm((prev) => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m < 1) {
        m = 12;
        y -= 1;
      } else if (m > 12) {
        m = 1;
        y += 1;
      }
      return { year: y, month: m };
    });

  const details = data ? mergedDetails(data) : [];

  const now = new Date();
  const isCurrentMonth = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1;

  const grid: { label: string; value: number }[] = data
    ? [
        { label: "収入", value: data.incomeLog },
        { label: "固定控除", value: data.fixedDeductions },
        { label: "変動控除", value: data.variableDeductions },
        ...(data.optionalDeductions ? [{ label: "自由控除", value: data.optionalDeductions }] : []),
        ...(data.leaseDeductions ? [{ label: "リース", value: data.leaseDeductions }] : []),
      ]
    : [];

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="px-4 pt-16 pb-10 gap-4">
      <Text className="text-lg font-bold text-brand-900">報酬</Text>

      <View className="flex-row items-center justify-center gap-5">
        <Pressable className="px-3.5 py-1 rounded-lg bg-brand-50 active:opacity-80" onPress={() => shiftMonth(-1)}>
          <Text className="text-xl text-brand-700 leading-6">‹</Text>
        </Pressable>
        <Text className="text-base font-semibold text-brand-900 min-w-[110px] text-center">{ym.year}年{ym.month}月</Text>
        <Pressable className="px-3.5 py-1 rounded-lg bg-brand-50 active:opacity-80" onPress={() => shiftMonth(1)}>
          <Text className="text-xl text-brand-700 leading-6">›</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text className="text-red-600 py-4">{error}</Text>
      ) : data ? (
        <>
          <View className="bg-white rounded-lg border border-brand-200 shadow-sm p-5">
            <Text className="text-[13px] text-brand-500 mb-1">
              今月の{isCurrentMonth ? "暫定" : ""}報酬
            </Text>
            <Text className="text-4xl font-bold text-brand-900">{formatYen(data.net)}</Text>

            <View className="flex-row flex-wrap gap-y-4 mt-5">
              {grid.map((b) => (
                <View key={b.label} className="w-1/2">
                  <Text className="text-[13px] text-brand-500 mb-0.5">{b.label}</Text>
                  <Text className={`text-lg font-semibold ${b.label === "収入" ? "text-brand-900" : "text-orange-500"}`}>
                    {b.label === "収入" ? formatYen(b.value) : `-${formatYen(b.value)}`}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View className="bg-white rounded-lg border border-brand-200 p-4">
            <Pressable className="flex-row items-center justify-between" onPress={() => setDetailsOpen((o) => !o)}>
              <Text className="text-sm font-semibold text-brand-800">詳細</Text>
              <Text className="text-brand-400">{detailsOpen ? "▲" : "▼"}</Text>
            </Pressable>
            {detailsOpen && (
              <View className="mt-3 pt-3 border-t border-brand-100 gap-2">
                {details.length === 0 ? (
                  <Text className="text-brand-500 text-[13px]">この月の明細はありません</Text>
                ) : (
                  details.map((d, i) => (
                    <View key={`${d.log_date}-${i}`} className="flex-row items-baseline flex-wrap gap-x-2">
                      <Text className="text-[13px] text-brand-600 font-medium">{formatMonthDayJP(d.log_date)}</Text>
                      <Text className="text-[13px] text-brand-800 flex-1" numberOfLines={1}>{logLabel(d)}</Text>
                      <Text className="text-[13px] text-brand-900 font-semibold">{formatYen(d.amount)}</Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>

          <View className="bg-white rounded-lg border border-brand-200 p-5">
            <Text className="text-base font-bold text-brand-900 mb-3">諸経費</Text>
            {data.fixedDetails.length > 0 ? (
              <View className="gap-2">
                {data.fixedDetails.map((e) => (
                  <View key={e.id} className="flex-row items-center justify-between p-3 bg-brand-50 rounded-lg">
                    <Text className="text-brand-800 text-[13px]">{e.name}</Text>
                    <Text className="text-orange-500 font-semibold text-[13px]">-{formatYen(e.amount)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-brand-400 text-[13px] text-center py-4">固定経費はありません</Text>
            )}
          </View>

          {data.optionalDetails && data.optionalDetails.length > 0 && (
            <View className="bg-white rounded-lg border border-brand-200 p-5">
              <Text className="text-base font-bold text-brand-900 mb-3">自由経費</Text>
              <View className="gap-2">
                {data.optionalDetails.map((e) => (
                  <View key={e.id} className="flex-row items-center justify-between p-3 bg-brand-50 rounded-lg">
                    <Text className="text-brand-800 text-[13px]">{e.name}</Text>
                    <Text className="text-orange-500 font-semibold text-[13px]">-{formatYen(e.amount)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
