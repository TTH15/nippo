import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal, StyleSheet } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { ShiftRequest, DriverSlot, PeriodInfo } from "@repo/core/types";
import { getDaysInMonth, toLocalDateStr, nowYearMonth0, formatYearMonth } from "@repo/core/logic/calendar";
import {
  ALL,
  requestsToOffMap,
  isLockedDate,
  dayOff,
  isWholeDayOff,
  hasAnyOff,
  toggleOffKey,
  hasOffChanges,
  buildOffEntries,
} from "@repo/core/logic/shift";

// ============================================================
// シフト（希望休提出）の RN 移植・第1弾。
// カレンダーで休み希望日（全休/便単位）をトグル → 提出。
// 判定・整形は Web と同じ @repo/core/logic/shift・calendar を再利用。
// シフト確認タブ（割当表示）・締切カード・凡例は次段。
// ※提出は書き込み（POST /api/shifts/requests）。
// ============================================================

type OffMap = ReturnType<typeof requestsToOffMap>;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

export function ShiftsScreen() {
  const [view, setView] = useState(nowYearMonth0); // month は 0-indexed
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [slots, setSlots] = useState<DriverSlot[]>([]);
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [off, setOff] = useState<OffMap>(() => requestsToOffMap([]));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pickerDate, setPickerDate] = useState<string | null>(null);

  const monthStr = formatYearMonth(view.year, view.month + 1);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [res, dl] = await Promise.all([
        apiFetch<{ requests: ShiftRequest[]; slots: DriverSlot[] }>(`/api/shifts/requests?month=${monthStr}`),
        apiFetch<{ periods: PeriodInfo[] }>(`/api/shifts/deadlines?month=${monthStr}`).catch(() => null),
      ]);
      setRequests(res.requests ?? []);
      setSlots(res.slots ?? []);
      setPeriods(dl?.periods ?? []);
      setOff(requestsToOffMap(res.requests ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "シフト情報の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  const shiftMonth = (delta: number) =>
    setView((v) => {
      let m = v.month + delta;
      let y = v.year;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      return { year: y, month: m };
    });

  const toggle = (dateStr: string, key: string) => setOff((prev) => toggleOffKey(prev, dateStr, key));

  const onDayPress = (date: Date) => {
    const dateStr = toLocalDateStr(date);
    if (isLockedDate(periods, dateStr)) return;
    if (slots.length === 0) toggle(dateStr, ALL);
    else setPickerDate(dateStr);
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const offEntries = buildOffEntries(off, monthStr, periods);
      await apiFetch("/api/shifts/requests", {
        method: "POST",
        body: JSON.stringify({ month: monthStr, offEntries }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const days = getDaysInMonth(view.year, view.month);
  const firstDow = new Date(view.year, view.month, 1).getDay();
  const todayStr = toLocalDateStr(new Date());
  const changed = hasOffChanges(requests, off);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>希望休</Text>
      <Text style={styles.hint}>休みたい日をタップして選択し、提出してください。</Text>

      <View style={styles.monthRow}>
        <Pressable style={styles.navBtn} onPress={() => shiftMonth(-1)}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          {view.year}年{view.month + 1}月
        </Text>
        <Pressable style={styles.navBtn} onPress={() => shiftMonth(1)}>
          <Text style={styles.navBtnText}>›</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.grid}>
            {DOW.map((d, i) => (
              <View key={d} style={styles.cell}>
                <Text style={[styles.dow, i === 0 && styles.sun, i === 6 && styles.sat]}>{d}</Text>
              </View>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => (
              <View key={`e${i}`} style={styles.cell} />
            ))}
            {days.map((date) => {
              const dateStr = toLocalDateStr(date);
              const locked = isLockedDate(periods, dateStr);
              const past = dateStr < todayStr;
              const whole = isWholeDayOff(off, dateStr);
              const partial = !whole && hasAnyOff(off, dateStr);
              const disabled = locked || past;
              return (
                <Pressable
                  key={dateStr}
                  style={[styles.cell, styles.day, whole && styles.dayWhole, partial && styles.dayPartial, disabled && styles.dayDisabled]}
                  onPress={() => !disabled && onDayPress(date)}
                  disabled={disabled}
                >
                  <Text style={[styles.dayNum, whole && styles.dayNumOff]}>{date.getDate()}</Text>
                  {whole ? <Text style={styles.mark}>休</Text> : partial ? <Text style={styles.markSm}>便{dayOff(off, dateStr).size}</Text> : locked ? <Text style={styles.lock}>🔒</Text> : null}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[styles.submit, (!changed || submitting) && styles.submitDisabled]}
            onPress={submit}
            disabled={!changed || submitting}
          >
            <Text style={styles.submitText}>{submitting ? "提出中..." : "希望休を提出"}</Text>
          </Pressable>
        </>
      )}

      {/* 便ピッカー */}
      <Modal visible={!!pickerDate} transparent animationType="fade" onRequestClose={() => setPickerDate(null)}>
        <Pressable style={styles.overlay} onPress={() => setPickerDate(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{pickerDate}</Text>
            <Text style={styles.hint}>全休、または休みたい便を選んでください。</Text>
            {pickerDate && (
              <>
                <Pressable
                  style={[styles.slotBtn, dayOff(off, pickerDate).has(ALL) && styles.slotActive]}
                  onPress={() => toggle(pickerDate, ALL)}
                >
                  <Text style={[styles.slotText, dayOff(off, pickerDate).has(ALL) && styles.slotTextActive]}>全休</Text>
                </Pressable>
                {slots.map((s) => {
                  const on = pickerDate ? dayOff(off, pickerDate).has(s.id) : false;
                  return (
                    <Pressable key={s.id} style={[styles.slotBtn, on && styles.slotActive]} onPress={() => toggle(pickerDate, s.id)}>
                      <Text style={[styles.slotText, on && styles.slotTextActive]}>{s.name}</Text>
                    </Pressable>
                  );
                })}
              </>
            )}
            <Pressable style={styles.close} onPress={() => setPickerDate(null)}>
              <Text style={styles.closeText}>閉じる</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f1f5f9" },
  content: { padding: 16, paddingTop: 64, gap: 12 },
  title: { fontSize: 26, fontWeight: "700", color: "#0f172a" },
  hint: { fontSize: 12, color: "#64748b" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
  navBtn: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 8, backgroundColor: "#e2e8f0" },
  navBtnText: { fontSize: 20, color: "#334155", lineHeight: 24 },
  monthLabel: { fontSize: 16, fontWeight: "600", color: "#0f172a", minWidth: 110, textAlign: "center" },
  center: { paddingVertical: 32, alignItems: "center" },
  error: { color: "#dc2626", paddingVertical: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", padding: 2 },
  dow: { fontSize: 12, color: "#64748b" },
  sun: { color: "#dc2626" },
  sat: { color: "#2563eb" },
  day: { borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#fff" },
  dayWhole: { backgroundColor: "#fee2e2", borderColor: "#fca5a5" },
  dayPartial: { backgroundColor: "#fef2f2", borderColor: "#fca5a5" },
  dayDisabled: { backgroundColor: "#f1f5f9", opacity: 0.5 },
  dayNum: { fontSize: 14, color: "#0f172a" },
  dayNumOff: { color: "#b91c1c", fontWeight: "700" },
  mark: { fontSize: 11, color: "#b91c1c", fontWeight: "700" },
  markSm: { fontSize: 9, color: "#b91c1c" },
  lock: { fontSize: 9 },
  submit: { marginTop: 8, backgroundColor: "#0f172a", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: "#fff", borderRadius: 12, padding: 20, gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  slotBtn: { paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center", backgroundColor: "#fff" },
  slotActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  slotText: { fontSize: 14, color: "#334155", fontWeight: "600" },
  slotTextActive: { color: "#fff" },
  close: { alignSelf: "center", paddingVertical: 8, marginTop: 4 },
  closeText: { color: "#64748b" },
});
