import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";
import type { ShiftRequest, DriverSlot, PeriodInfo, MeShift } from "@repo/core/types";
import {
  getDaysInMonth,
  monthDateRange,
  toLocalDateStr,
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
import { MonthPager, MonthTitle, MonthPickerSheet, ymKey, type YM } from "../components/MonthPager";

// ============================================================
// シフト（シフト確認 / 希望休提出）。Web版 apps/web/.../shifts/page.tsx と
// サブタブ構成・判定ロジックを揃える（判定・整形は @repo/core/logic を共有）。
// 月の移動は MonthPager（スワイプ）＋ MonthTitle タップの年月ピッカー。前月/翌月ボタンは置かない。
// ============================================================

type OffMap = ReturnType<typeof requestsToOffMap>;
type SubTab = "view" | "request";
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const CELL = "aspect-square items-center justify-center p-0.5";

// カレンダーの列幅。flex-1 の等分配は空セルと内容ありセルで割付が微妙にずれる（Yoga の挙動）ため、
// 全セルに同じ%幅を明示して罫線を揃える。
const COL = { width: "14.2857%" } as const;

// 7列ぴったりの週配列に整形する。flex-wrap の %幅は Yoga の丸めで7列目が折り返す
// ことがある（土曜列が空く実バグ）ため、週ごとの flex-row で列を保証する。
function buildWeeks(firstDow: number, days: Date[]): (Date | null)[][] {
  const cells: (Date | null)[] = [...Array.from({ length: firstDow }, (): null => null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const monthDays = (ym: YM) => getDaysInMonth(ym.year, ym.month - 1);
const monthFirstDow = (ym: YM) => new Date(ym.year, ym.month - 1, 1).getDay();

export function ShiftsScreen() {
  const [subTab, setSubTab] = useState<SubTab>("view");

  return (
    <View className="flex-1 bg-white pt-3">
      <View className="px-4">
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

// 月別シフトのメモリキャッシュ。スワイプで行き来しても再フェッチで待たせない
// （表示は即キャッシュ、裏で常に更新）。
const shiftMonthCache = new Map<string, MeShift[]>();

function ShiftConfirmView() {
  const [month, setMonth] = useState<YM>(nowYearMonth1);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <ScrollView className="flex-1" contentContainerClassName="pt-1 pb-10">
      <MonthTitle ym={month} onPress={() => setPickerOpen(true)} />
      <MonthPager
        ym={month}
        onChange={setMonth}
        renderMonth={(m) => (
          <View className="px-4 pt-1">
            <ShiftMonthGrid ym={m} />
          </View>
        )}
      />
      <MonthPickerSheet visible={pickerOpen} ym={month} onSelect={setMonth} onClose={() => setPickerOpen(false)} />
    </ScrollView>
  );
}

function ShiftMonthGrid({ ym }: { ym: YM }) {
  const key = ymKey(ym);
  const cached = shiftMonthCache.get(key);
  const [shifts, setShifts] = useState<MeShift[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const hit = shiftMonthCache.get(key);
    if (hit) setShifts(hit);
    setLoading(!hit);
    setError("");
    const { start, end } = monthDateRange(ym.year, ym.month);
    apiFetch<{ shifts: MeShift[] }>(`/api/me/shifts?start=${start}&end=${end}`)
      .then((res) => {
        shiftMonthCache.set(key, res.shifts ?? []);
        if (!cancelled) setShifts(res.shifts ?? []);
      })
      .catch((e) => {
        if (!cancelled && !hit) setError(e instanceof Error ? e.message : "シフトの取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const shiftsByDate = useMemo(() => {
    const m = new Map<string, MeShift[]>();
    shifts.forEach((s) => {
      const list = m.get(s.shift_date) ?? [];
      list.push(s);
      m.set(s.shift_date, list);
    });
    return m;
  }, [shifts]);

  const todayStr = toLocalDateStr(new Date());

  if (loading) {
    return (
      <View className="py-16 items-center">
        <ActivityIndicator />
      </View>
    );
  }
  if (error) return <ErrorBanner message={error} />;

  return (
    <View className="bg-white rounded border border-brand-300 overflow-hidden">
      <View className="flex-row bg-brand-50 border-b border-brand-300">
        {DOW.map((d, i) => (
          <View key={d} style={COL} className="items-center py-1.5">
            <Text className={`text-xs font-medium ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-brand-500"}`}>{d}</Text>
          </View>
        ))}
      </View>
      <View>
        {buildWeeks(monthFirstDow(ym), monthDays(ym)).map((week, wi) => (
          <View key={wi} className="flex-row">
            {week.map((date, di) => {
              if (!date) {
                return <View key={`e${di}`} style={COL} className="min-h-[80px] border-b border-r border-brand-100 bg-brand-50" />;
              }
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
                  style={COL}
                  className={`min-h-[80px] border-b border-r border-brand-100 p-1 items-center ${isToday ? "bg-accent-50" : "bg-white"}`}
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
        ))}
      </View>
    </View>
  );
}

// ------------------------------------------------------------
// 希望休提出タブ
// ------------------------------------------------------------

// 左右の覗きページ用: 日付だけの飾りグリッド（操作不可）。
function PlainMonthGrid({ ym }: { ym: YM }) {
  return (
    <View className="bg-white rounded border border-brand-200 p-3 opacity-50" pointerEvents="none">
      <View className="flex-row">
        {DOW.map((d, i) => (
          <View key={d} style={COL} className="items-center py-1">
            <Text className={`text-xs font-medium ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-brand-500"}`}>{d}</Text>
          </View>
        ))}
      </View>
      {buildWeeks(monthFirstDow(ym), monthDays(ym)).map((week, wi) => (
        <View key={wi} className="flex-row">
          {week.map((date, di) =>
            date ? (
              <View key={toLocalDateStr(date)} style={COL} className={`${CELL} rounded-lg border bg-white border-brand-100`}>
                <Text className="text-sm text-brand-900">{date.getDate()}</Text>
              </View>
            ) : (
              <View key={`e${di}`} style={COL} className={CELL} />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

function ShiftRequestView() {
  const [ym, setYm] = useState<YM>(nowYearMonth1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [slots, setSlots] = useState<DriverSlot[]>([]);
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [off, setOff] = useState<OffMap>(() => requestsToOffMap([]));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pickerDate, setPickerDate] = useState<string | null>(null);

  const monthStr = formatYearMonth(ym.year, ym.month);

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

  const todayStr = toLocalDateStr(new Date());
  const changed = hasOffChanges(requests, off);

  const slotName = (id: string) => slots.find((s) => s.id === id)?.name ?? "便";
  const selectedDates = [...off.keys()].filter((d) => d.startsWith(monthStr) && dayOff(off, d).size > 0).sort();

  return (
    <ScrollView className="flex-1" contentContainerClassName="pt-2 pb-10 gap-4">
      <View className="px-4">
        <Text className="text-[13px] text-brand-500">休みを希望する日をタップして選択し、まとめて提出します。</Text>
      </View>

      <MonthTitle ym={ym} onPress={() => setPickerOpen(true)} />

      {periods.length > 0 && (
        <View className="px-4 flex-row flex-wrap gap-2">
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

      <MonthPager
        ym={ym}
        onChange={setYm}
        renderMonth={(m, isCenter) => (
          <View className="px-4">
            {!isCenter ? (
              <PlainMonthGrid ym={m} />
            ) : loading ? (
              <View className="py-16 items-center">
                <ActivityIndicator />
              </View>
            ) : (
              <View className="bg-white rounded border border-brand-200 p-3">
                <View className="flex-row">
                  {DOW.map((d, i) => (
                    <View key={d} style={COL} className="items-center py-1">
                      <Text className={`text-xs font-medium ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-brand-500"}`}>{d}</Text>
                    </View>
                  ))}
                </View>
                {buildWeeks(monthFirstDow(m), monthDays(m)).map((week, wi) => (
                  <View key={wi} className="flex-row">
                    {week.map((date, di) => {
                      if (!date) return <View key={`e${di}`} style={COL} className={CELL} />;
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
                          style={COL}
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
                ))}
              </View>
            )}
          </View>
        )}
      />

      <View className="px-4 gap-4">
        {error ? <ErrorBanner message={error} /> : null}

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
              {ym.month}月の希望休: {selectedDates.length}日
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
      </View>

      <MonthPickerSheet visible={pickerOpen} ym={ym} onSelect={setYm} onClose={() => setPickerOpen(false)} />

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
