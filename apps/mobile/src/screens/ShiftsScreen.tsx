import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";
import type { ShiftRequest, DriverSlot, PeriodInfo, MeShift } from "@repo/core/types";
import {
  getDaysInMonth,
  monthDateRange,
  toLocalDateStr,
  nowYearMonth0,
  nowYearMonth1,
  formatYearMonth,
} from "@repo/core/logic/calendar";
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
import { VehiclePlateMini } from "../components/VehiclePlateMini";

// ============================================================
// シフト（シフト確認 / 希望休提出）。Web版 apps/web/.../shifts/page.tsx と
// サブタブ構成・判定ロジックを揃える（判定・整形は @repo/core/logic を共有）。
// ============================================================

type OffMap = ReturnType<typeof requestsToOffMap>;
type SubTab = "view" | "request";
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const CELL = "w-[14.2857%] aspect-square items-center justify-center p-0.5";

export function ShiftsScreen() {
  const [subTab, setSubTab] = useState<SubTab>("view");

  return (
    <View className="flex-1 bg-white pt-16">
      <View className="px-4 gap-3">
        <Text className="text-lg font-bold text-brand-900">シフト</Text>
        <View className="flex-row border-b border-brand-200">
          {(
            [
              { id: "view" as const, label: "シフト確認" },
              { id: "request" as const, label: "希望休提出" },
            ]
          ).map((tab) => (
            <Pressable
              key={tab.id}
              className={`flex-1 items-center py-2.5 border-b-2 ${subTab === tab.id ? "border-brand-900" : "border-transparent"}`}
              onPress={() => setSubTab(tab.id)}
            >
              <Text className={`text-sm font-medium ${subTab === tab.id ? "text-brand-900" : "text-brand-400"}`}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {subTab === "view" ? <ShiftConfirmView /> : <ShiftRequestView />}
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View className="flex-row items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
      <FontAwesome6 name="triangle-exclamation" size={12} color="#b91c1c" iconStyle="solid" />
      <Text className="text-red-700 text-[13px] flex-1">{message}</Text>
    </View>
  );
}

// ------------------------------------------------------------
// シフト確認タブ
// ------------------------------------------------------------
function ShiftConfirmView() {
  const [month, setMonth] = useState(nowYearMonth1);
  const [shifts, setShifts] = useState<MeShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const { start, end } = monthDateRange(month.year, month.month);
    apiFetch<{ shifts: MeShift[] }>(`/api/me/shifts?start=${start}&end=${end}`)
      .then((res) => {
        if (!cancelled) setShifts(res.shifts ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "シフトの取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month.year, month.month]);

  const shiftsByDate = useMemo(() => {
    const m = new Map<string, MeShift[]>();
    shifts.forEach((s) => {
      const list = m.get(s.shift_date) ?? [];
      list.push(s);
      m.set(s.shift_date, list);
    });
    return m;
  }, [shifts]);

  const shiftMonth = (delta: number) =>
    setMonth((v) => {
      let m = v.month + delta;
      let y = v.year;
      if (m < 1) {
        m = 12;
        y -= 1;
      } else if (m > 12) {
        m = 1;
        y += 1;
      }
      return { year: y, month: m };
    });

  const days = getDaysInMonth(month.year, month.month - 1);
  const firstDow = new Date(month.year, month.month - 1, 1).getDay();
  const todayStr = toLocalDateStr(new Date());

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-10 gap-4">
      <View className="flex-row items-center justify-between">
        <Pressable className="px-3 py-1.5 rounded bg-white border border-brand-200 active:opacity-70" onPress={() => shiftMonth(-1)}>
          <Text className="text-[13px] text-brand-600">← 前月</Text>
        </Pressable>
        <Text className="text-base font-semibold text-brand-900">{month.year}年 {month.month}月</Text>
        <Pressable className="px-3 py-1.5 rounded bg-white border border-brand-200 active:opacity-70" onPress={() => shiftMonth(1)}>
          <Text className="text-[13px] text-brand-600">翌月 →</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <View className="bg-white rounded border border-brand-300 overflow-hidden">
          <View className="flex-row bg-brand-50 border-b border-brand-300">
            {DOW.map((d, i) => (
              <View key={d} className="flex-1 items-center py-1.5">
                <Text className={`text-xs font-medium ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-brand-500"}`}>{d}</Text>
              </View>
            ))}
          </View>
          <View className="flex-row flex-wrap">
            {Array.from({ length: firstDow }).map((_, i) => (
              <View key={`e${i}`} className="w-[14.2857%] min-h-[80px] border-b border-r border-brand-100 bg-brand-50" />
            ))}
            {days.map((date) => {
              const dateStr = toLocalDateStr(date);
              const dayShifts = shiftsByDate.get(dateStr) ?? [];
              const dow = date.getDay();
              const isToday = dateStr === todayStr;
              const vehicles = Array.from(
                new Map(dayShifts.filter((s) => s.vehicle).map((s) => [s.vehicle!.id, s.vehicle!])).values(),
              );
              return (
                <View
                  key={dateStr}
                  className={`w-[14.2857%] min-h-[80px] border-b border-r border-brand-100 p-1 items-center ${isToday ? "bg-accent-50" : "bg-white"}`}
                >
                  <Text className={`text-xs font-medium ${dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-brand-700"}`}>
                    {date.getDate()}
                  </Text>
                  <View className="flex-row flex-wrap justify-center gap-0.5 mt-0.5">
                    {dayShifts.map((s, idx) => (
                      <View
                        key={`${s.shift_date}-${idx}`}
                        className="rounded px-1 py-0.5"
                        style={{ backgroundColor: s.course_color || "#e2e8f0" }}
                      >
                        <Text className="text-[8px] font-medium text-white" numberOfLines={1} style={!s.course_color ? { color: "#475569" } : undefined}>
                          {s.course_name || "-"}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {vehicles.length > 0 && (
                    <View className="mt-auto gap-0.5 items-center pt-0.5">
                      {vehicles.map((v) => (
                        <VehiclePlateMini key={v.id} vehicle={v} />
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ------------------------------------------------------------
// 希望休提出タブ
// ------------------------------------------------------------
function ShiftRequestView() {
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

  const slotName = (id: string) => slots.find((s) => s.id === id)?.name ?? "便";
  const selectedDates = [...off.keys()].filter((d) => d.startsWith(monthStr) && dayOff(off, d).size > 0).sort();

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-10 gap-4">
      <Text className="text-[13px] text-brand-500">休みを希望する日をタップして選択し、まとめて提出します。</Text>

      <View className="flex-row items-center justify-between">
        <Pressable className="px-3 py-1.5 rounded bg-white border border-brand-200 active:opacity-70" onPress={() => shiftMonth(-1)}>
          <Text className="text-[13px] text-brand-600">← 前月</Text>
        </Pressable>
        <Text className="text-base font-semibold text-brand-900">{view.year}年 {view.month + 1}月</Text>
        <Pressable className="px-3 py-1.5 rounded bg-white border border-brand-200 active:opacity-70" onPress={() => shiftMonth(1)}>
          <Text className="text-[13px] text-brand-600">翌月 →</Text>
        </Pressable>
      </View>

      {periods.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {periods.map((p) => (
            <View
              key={p.seq}
              className={`rounded border px-3 py-2 ${p.closed ? "border-brand-200 bg-brand-50" : "border-emerald-200 bg-emerald-50"}`}
            >
              <Text className="text-xs font-medium text-brand-600">{p.label}日</Text>
              <View className="flex-row items-center flex-wrap mt-0.5">
                <Text className={`text-xs ${p.closed ? "text-brand-400" : "text-brand-500"}`}>締切 {p.deadline.split("-")[1]}/{p.deadline.split("-")[2]} </Text>
                {p.closed ? (
                  <View className="flex-row items-center gap-1">
                    <FontAwesome6 name="lock" size={9} color="#7c848f" iconStyle="solid" />
                    <Text className="text-xs text-brand-500 font-semibold">受付終了</Text>
                  </View>
                ) : (
                  <Text className="text-xs text-emerald-700 font-semibold">受付中</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : (
        <>
          {error ? <ErrorBanner message={error} /> : null}
          <View className="bg-white rounded border border-brand-200 p-3">
            <View className="flex-row flex-wrap">
              {DOW.map((d, i) => (
                <View key={d} className={CELL}>
                  <Text className={`text-xs font-medium ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-brand-500"}`}>{d}</Text>
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
                    : "bg-white border-brand-100";
                return (
                  <Pressable
                    key={dateStr}
                    className={`${CELL} rounded-lg border ${box} ${disabled ? "opacity-40" : ""}`}
                    onPress={() => !disabled && onDayPress(date)}
                    disabled={disabled}
                  >
                    <Text className={`text-sm ${whole ? "text-red-700 font-bold" : "text-brand-900"}`}>{date.getDate()}</Text>
                    {whole ? (
                      <FontAwesome6 name="xmark" size={11} color="#b91c1c" iconStyle="solid" />
                    ) : partial ? (
                      <Text className="text-[9px] text-red-700 font-bold">便{dayOff(off, dateStr).size}</Text>
                    ) : locked ? (
                      <FontAwesome6 name="lock" size={9} color="#a9b0b8" iconStyle="solid" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="flex-row items-center gap-4">
            <View className="flex-row items-center gap-1.5">
              <View className="w-4 h-4 bg-red-100 border border-red-300 rounded items-center justify-center">
                <Text className="text-red-500 text-[10px] font-bold">×</Text>
              </View>
              <Text className="text-xs text-brand-500">全休</Text>
            </View>
            {slots.length > 0 && (
              <View className="flex-row items-center gap-1.5">
                <View className="w-4 h-4 bg-red-50 border border-red-300 rounded items-center justify-center">
                  <Text className="text-red-500 text-[8px] font-bold">便</Text>
                </View>
                <Text className="text-xs text-brand-500">便のみ希望（タップで選択）</Text>
              </View>
            )}
          </View>

          {changed && (
            <Pressable
              className={`bg-brand-600 py-3.5 rounded-lg items-center active:opacity-80 ${submitting ? "opacity-50" : ""}`}
              onPress={submit}
              disabled={submitting}
            >
              <Text className="text-white font-semibold text-base">{submitting ? "送信中..." : "希望休を提出する"}</Text>
            </Pressable>
          )}

          {selectedDates.length > 0 && (
            <View className="bg-brand-50 rounded border border-brand-200 p-3 gap-1.5">
              <Text className="text-sm font-medium text-brand-700 mb-0.5">
                {view.month + 1}月の希望休: {selectedDates.length}日
              </Text>
              {selectedDates.map((dateStr) => {
                const [y, m, d] = dateStr.split("-").map(Number);
                const localDate = new Date(y, m - 1, d);
                const set = dayOff(off, dateStr);
                const detail = set.has(ALL) ? "全休" : [...set].map(slotName).join("・");
                return (
                  <View key={dateStr} className="flex-row items-center gap-2">
                    <Text className="text-xs px-2 py-0.5 bg-white border border-brand-200 text-brand-600 rounded">
                      {localDate.getMonth() + 1}/{localDate.getDate()}({DOW[localDate.getDay()]})
                    </Text>
                    <Text className="text-xs text-brand-500">{detail}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      {/* 便ピッカー */}
      <Modal visible={!!pickerDate} transparent animationType="fade" onRequestClose={() => setPickerDate(null)}>
        <Pressable className="flex-1 bg-black/40 justify-center p-6" onPress={() => setPickerDate(null)}>
          <Pressable className="bg-white rounded-xl p-5 gap-2.5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-base font-bold text-brand-900">{pickerDate}</Text>
            <Text className="text-xs text-brand-500">全休、または休みたい便を選んでください。</Text>
            {pickerDate && (
              <>
                <Pressable
                  className={`py-3 rounded-lg border items-center ${dayOff(off, pickerDate).has(ALL) ? "bg-red-100 border-red-300" : "bg-white border-brand-200"}`}
                  onPress={() => toggle(pickerDate, ALL)}
                >
                  <Text className={`text-sm font-medium ${dayOff(off, pickerDate).has(ALL) ? "text-red-700" : "text-brand-700"}`}>全休（1日休み）</Text>
                </Pressable>
                <View className="flex-row flex-wrap gap-2">
                  {slots.map((s) => {
                    const on = pickerDate ? dayOff(off, pickerDate).has(s.id) : false;
                    return (
                      <Pressable
                        key={s.id}
                        className={`flex-1 min-w-[45%] py-3 rounded-lg border items-center ${on ? "bg-red-100 border-red-300" : "bg-white border-brand-200"}`}
                        onPress={() => toggle(pickerDate, s.id)}
                      >
                        <Text className={`text-sm font-medium ${on ? "text-red-700" : "text-brand-700"}`}>{s.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            <Pressable className="mt-1 py-2.5 rounded-lg bg-brand-800 items-center" onPress={() => setPickerDate(null)}>
              <Text className="text-white text-sm font-medium">決定</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
