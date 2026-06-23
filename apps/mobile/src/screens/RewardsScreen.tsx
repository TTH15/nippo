import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { RewardsSummary } from "@repo/core/types";
import { nowYearMonth1, formatYearMonth, formatMonthDayJP } from "@repo/core/logic/calendar";
import { mergedDetails, logLabel, formatYen } from "@repo/core/logic/reward";

// ============================================================
// 報酬（me/rewards）の RN 移植・第1弾＝月次サマリ＋明細（読み取り専用）。
// 計算・整形は Web と同じ @repo/core/logic/reward・calendar を再利用。
// 任意経費の追加/削除・請求書承認（書き込み系）は次段（dev 接続後）。
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
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>報酬</Text>

      {/* 月切替 */}
      <View style={styles.monthRow}>
        <Pressable style={styles.navBtn} onPress={() => shiftMonth(-1)}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          {ym.year}年{ym.month}月
        </Text>
        <Pressable style={styles.navBtn} onPress={() => shiftMonth(1)}>
          <Text style={styles.navBtnText}>›</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : data ? (
        <>
          {/* 純額 */}
          <View style={styles.netCard}>
            <Text style={styles.netLabel}>差引支給額</Text>
            <Text style={styles.netValue}>{formatYen(data.net)}</Text>
          </View>

          {/* 内訳 */}
          <View style={styles.card}>
            {breakdown.map((b) => (
              <View key={b.label} style={styles.row}>
                <Text style={styles.rowLabel}>{b.label}</Text>
                <Text style={styles.rowValue}>{formatYen(b.value)}</Text>
              </View>
            ))}
          </View>

          {/* 明細 */}
          <Pressable style={styles.toggle} onPress={() => setOpen((o) => !o)}>
            <Text style={styles.toggleText}>明細 {open ? "▲" : "▼"}</Text>
          </Pressable>
          {open && (
            <View style={styles.card}>
              {details.length === 0 ? (
                <Text style={styles.empty}>明細はありません</Text>
              ) : (
                details.map((d, i) => (
                  <View key={`${d.log_date}-${i}`} style={styles.row}>
                    <Text style={styles.detailDate}>{formatMonthDayJP(d.log_date)}</Text>
                    <Text style={styles.detailLabel} numberOfLines={1}>
                      {logLabel(d)}
                    </Text>
                    <Text style={styles.rowValue}>{formatYen(d.amount)}</Text>
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

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f1f5f9" },
  content: { padding: 20, paddingTop: 64, gap: 12 },
  title: { fontSize: 26, fontWeight: "700", color: "#0f172a" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
  navBtn: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 8, backgroundColor: "#e2e8f0" },
  navBtnText: { fontSize: 20, color: "#334155", lineHeight: 24 },
  monthLabel: { fontSize: 16, fontWeight: "600", color: "#0f172a", minWidth: 110, textAlign: "center" },
  center: { paddingVertical: 32, alignItems: "center" },
  error: { color: "#dc2626", paddingVertical: 16 },
  netCard: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  netLabel: { color: "#94a3b8", fontSize: 13 },
  netValue: { color: "#fff", fontSize: 30, fontWeight: "700", marginTop: 4 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
    gap: 10,
  },
  rowLabel: { fontSize: 14, color: "#334155", flex: 1 },
  rowValue: { fontSize: 14, color: "#0f172a", fontWeight: "600" },
  toggle: { alignSelf: "flex-start", paddingVertical: 6 },
  toggleText: { fontSize: 14, color: "#2563eb", fontWeight: "600" },
  empty: { padding: 16, color: "#94a3b8", fontSize: 13 },
  detailDate: { fontSize: 12, color: "#64748b", width: 56 },
  detailLabel: { fontSize: 13, color: "#334155", flex: 1 },
});
