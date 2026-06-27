import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal } from "react-native";
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
// シフト（希望休提出）。カレンダーで休み希望日（全休/便単位）をトグル → 提出。NativeWind。
// 判定・整形は Web と同じ @repo/core/logic/shift・calendar を再利用。
// ※提出は書き込み（POST /api/shifts/requests）。
// ============================================================

type OffMap = ReturnType<typeof requestsToOffMap>;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const CELL = "w-[14.2857%] aspect-square items-center justify-center p-0.5";

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
    <ScrollView className="flex-1 bg-slate-100" contentContainerClassName="p-4 pt-16 gap-3">
      <Text className="text-[26px] font-bold text-slate-900">希望休</Text>
      <Text className="text-xs text-slate-500">休みたい日をタップして選択し、提出してください。</Text>

      <View className="flex-row items-center justify-center gap-5">
        <Pressable className="px-3.5 py-1 rounded-lg bg-slate-200 active:opacity-80" onPress={() => shiftMonth(-1)}>
          <Text className="text-xl text-slate-700 leading-6">‹</Text>
        </Pressable>
        <Text className="text-base font-semibold text-slate-900 min-w-[110px] text-center">{view.year}年{view.month + 1}月</Text>
        <Pressable className="px-3.5 py-1 rounded-lg bg-slate-200 active:opacity-80" onPress={() => shiftMonth(1)}>
          <Text className="text-xl text-slate-700 leading-6">›</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : (
        <>
          {error ? <Text className="text-red-600 py-2">{error}</Text> : null}
          <View className="flex-row flex-wrap">
            {DOW.map((d, i) => (
              <View key={d} className={CELL}>
                <Text className={`text-xs ${i === 0 ? "text-red-600" : i === 6 ? "text-blue-600" : "text-slate-500"}`}>{d}</Text>
              </View>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => (
              <View key={`e${i}`} className={CELL} />
            ))}
            {days.map((date) => {
              const dateStr = toLocalDateStr(date);
              const locked = isLockedDate(periods, dateStr);
              const past = dateStr < todayStr;
              const whole = isWholeDayOff(off, dateStr);
              const partial = !whole && hasAnyOff(off, dateStr);
              const disabled = locked || past;
              const box = whole
                ? "bg-red-100 border-red-300"
                : partial
                  ? "bg-red-50 border-red-300"
                  : "bg-white border-slate-200";
              return (
                <Pressable
                  key={dateStr}
                  className={`${CELL} rounded-lg border ${box} ${disabled ? "opacity-50" : ""}`}
                  onPress={() => !disabled && onDayPress(date)}
                  disabled={disabled}
                >
                  <Text className={`text-sm ${whole ? "text-red-700 font-bold" : "text-slate-900"}`}>{date.getDate()}</Text>
                  {whole ? (
                    <Text className="text-[11px] text-red-700 font-bold">休</Text>
                  ) : partial ? (
                    <Text className="text-[9px] text-red-700">便{dayOff(off, dateStr).size}</Text>
                  ) : locked ? (
                    <Text className="text-[9px]">🔒</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            className={`mt-2 bg-slate-900 py-3.5 rounded-lg items-center active:opacity-80 ${!changed || submitting ? "opacity-40" : ""}`}
            onPress={submit}
            disabled={!changed || submitting}
          >
            <Text className="text-white font-bold text-base">{submitting ? "提出中..." : "希望休を提出"}</Text>
          </Pressable>
        </>
      )}

      {/* 便ピッカー */}
      <Modal visible={!!pickerDate} transparent animationType="fade" onRequestClose={() => setPickerDate(null)}>
        <Pressable className="flex-1 bg-black/40 justify-center p-6" onPress={() => setPickerDate(null)}>
          <Pressable className="bg-white rounded-xl p-5 gap-2.5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-base font-bold text-slate-900">{pickerDate}</Text>
            <Text className="text-xs text-slate-500">全休、または休みたい便を選んでください。</Text>
            {pickerDate && (
              <>
                <Pressable
                  className={`py-3 rounded-lg border items-center ${dayOff(off, pickerDate).has(ALL) ? "bg-slate-900 border-slate-900" : "bg-white border-slate-200"}`}
                  onPress={() => toggle(pickerDate, ALL)}
                >
                  <Text className={`text-sm font-semibold ${dayOff(off, pickerDate).has(ALL) ? "text-white" : "text-slate-700"}`}>全休</Text>
                </Pressable>
                {slots.map((s) => {
                  const on = pickerDate ? dayOff(off, pickerDate).has(s.id) : false;
                  return (
                    <Pressable
                      key={s.id}
                      className={`py-3 rounded-lg border items-center ${on ? "bg-slate-900 border-slate-900" : "bg-white border-slate-200"}`}
                      onPress={() => toggle(pickerDate, s.id)}
                    >
                      <Text className={`text-sm font-semibold ${on ? "text-white" : "text-slate-700"}`}>{s.name}</Text>
                    </Pressable>
                  );
                })}
              </>
            )}
            <Pressable className="self-center py-2 mt-1" onPress={() => setPickerDate(null)}>
              <Text className="text-slate-500">閉じる</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
