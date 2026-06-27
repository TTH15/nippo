import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { RewardsSummary } from "@repo/core/types";
import { nowYearMonth1, formatYearMonth, formatMonthDayJP } from "@repo/core/logic/calendar";
import { mergedDetails, logLabel, formatYen } from "@repo/core/logic/reward";

// ============================================================
// 報酬（me/rewards）＝月次サマリ＋明細（読み取り専用）。NativeWind。
// 計算・整形は Web と同じ @repo/core/logic/reward・calendar を再利用。
// ============================================================

export function RewardsScreen() {
  const [ym, setYm] = useState(nowYearMonth1);
  const [data, setData] = useState<RewardsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

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

  const breakdown: { label: string; value: number }[] = data
    ? [
        { label: "収入", value: data.incomeLog },
        { label: "変動控除", value: -data.variableDeductions },
        { label: "固定控除", value: -data.fixedDeductions },
        ...(data.optionalDeductions ? [{ label: "任意控除", value: -data.optionalDeductions }] : []),
        ...(data.leaseDeductions ? [{ label: "リース控除", value: -data.leaseDeductions }] : []),
      ]
    : [];

  return (
    <ScrollView className="flex-1 bg-slate-100" contentContainerClassName="p-5 pt-16 gap-3">
      <Text className="text-[26px] font-bold text-slate-900">報酬</Text>

      <View className="flex-row items-center justify-center gap-5">
        <Pressable className="px-3.5 py-1 rounded-lg bg-slate-200 active:opacity-80" onPress={() => shiftMonth(-1)}>
          <Text className="text-xl text-slate-700 leading-6">‹</Text>
        </Pressable>
        <Text className="text-base font-semibold text-slate-900 min-w-[110px] text-center">{ym.year}年{ym.month}月</Text>
        <Pressable className="px-3.5 py-1 rounded-lg bg-slate-200 active:opacity-80" onPress={() => shiftMonth(1)}>
          <Text className="text-xl text-slate-700 leading-6">›</Text>
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
          <View className="bg-slate-900 rounded-xl py-5 px-5 items-center">
            <Text className="text-slate-400 text-[13px]">差引支給額</Text>
            <Text className="text-white text-[30px] font-bold mt-1">{formatYen(data.net)}</Text>
          </View>

          <View className="bg-white rounded-[10px] border border-slate-200 overflow-hidden">
            {breakdown.map((b) => (
              <View key={b.label} className="flex-row items-center py-3 px-4 gap-2.5 border-b border-slate-200">
                <Text className="text-sm text-slate-700 flex-1">{b.label}</Text>
                <Text className="text-sm text-slate-900 font-semibold">{formatYen(b.value)}</Text>
              </View>
            ))}
          </View>

          <Pressable className="self-start py-1.5" onPress={() => setOpen((o) => !o)}>
            <Text className="text-sm text-blue-600 font-semibold">明細 {open ? "▲" : "▼"}</Text>
          </Pressable>
          {open && (
            <View className="bg-white rounded-[10px] border border-slate-200 overflow-hidden">
              {details.length === 0 ? (
                <Text className="p-4 text-slate-400 text-[13px]">明細はありません</Text>
              ) : (
                details.map((d, i) => (
                  <View key={`${d.log_date}-${i}`} className="flex-row items-center py-3 px-4 gap-2.5 border-b border-slate-200">
                    <Text className="text-xs text-slate-500 w-14">{formatMonthDayJP(d.log_date)}</Text>
                    <Text className="text-[13px] text-slate-700 flex-1" numberOfLines={1}>{logLabel(d)}</Text>
                    <Text className="text-sm text-slate-900 font-semibold">{formatYen(d.amount)}</Text>
                  </View>
                ))
              )}
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
