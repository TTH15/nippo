import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";

// ============================================================
// 運営モード・日報承認（最低限版）: 未承認の日報を一覧し、承認/却下する。
// Web版 admin/daily/pending・approve・reject と同じAPIをそのまま利用。
// 明細の内訳表示はスコープ外（M-D統合時にデザインごと作り込む）。
// ============================================================

type PendingEntry = {
  driver: { id: string; name: string; display_name: string | null };
  report: {
    id: string;
    report_date: string;
    course_name: string | null;
    submitted_at: string | null;
  };
};

type PendingGroup = { date: string; entries: PendingEntry[] };

export function AdminDailyScreen() {
  const [groups, setGroups] = useState<PendingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ groups: PendingGroup[] }>("/api/admin/daily/pending");
      setGroups(res.groups ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (entry: PendingEntry, action: "approve" | "reject") => {
    const key = `${entry.driver.id}-${entry.report.report_date}`;
    setBusyKey(key);
    try {
      await apiFetch(`/api/admin/daily/${action}`, {
        method: "POST",
        body: JSON.stringify({ driverId: entry.driver.id, date: entry.report.report_date }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <ScrollView className="flex-1 bg-brand-50" contentContainerClassName="px-4 pt-16 pb-10 gap-4">
      <Text className="text-lg font-bold text-brand-900">日報承認</Text>
      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text className="text-red-600 text-[13px]">{error}</Text>
      ) : groups.length === 0 ? (
        <Text className="text-brand-500 text-[13px] text-center py-8">承認待ちの日報はありません</Text>
      ) : (
        groups.map((g) => (
          <View key={g.date} className="gap-2">
            <Text className="text-[13px] font-semibold text-brand-500">{g.date}</Text>
            {g.entries.map((entry) => {
              const key = `${entry.driver.id}-${entry.report.report_date}`;
              const name = entry.driver.display_name || entry.driver.name;
              return (
                <View key={entry.report.id} className="bg-white rounded-lg border border-brand-200 p-4 gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-brand-900">{name}</Text>
                    {entry.report.submitted_at && (
                      <Text className="text-[11px] text-brand-400">
                        {new Date(entry.report.submitted_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}提出
                      </Text>
                    )}
                  </View>
                  {entry.report.course_name && <Text className="text-[13px] text-brand-600">{entry.report.course_name}</Text>}
                  <View className="flex-row gap-2 mt-1">
                    <Pressable
                      className={`flex-1 py-2 rounded-lg border border-red-200 bg-red-50 items-center ${busyKey === key ? "opacity-50" : ""}`}
                      onPress={() => decide(entry, "reject")}
                      disabled={busyKey === key}
                    >
                      <Text className="text-red-600 text-[13px] font-medium">却下</Text>
                    </Pressable>
                    <Pressable
                      className={`flex-1 py-2 rounded-lg bg-brand-900 items-center flex-row justify-center gap-1.5 ${busyKey === key ? "opacity-50" : ""}`}
                      onPress={() => decide(entry, "approve")}
                      disabled={busyKey === key}
                    >
                      {busyKey === key ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <FontAwesome6 name="check" size={12} color="#fff" iconStyle="solid" />
                          <Text className="text-white text-[13px] font-medium">承認</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}
