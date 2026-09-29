import { shiftDateLabel } from "../shifts/presentation";
import { resolveMonthRests } from "../shifts/presentation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal, Alert } from "react-native";
import { AppIcon } from "../components/AppIcon";
import { apiFetch } from "@repo/core/api";
import type { ShiftRequest, DriverSlot, PeriodInfo, MeShift, MeShiftsResponse } from "@repo/core/types";
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
import { ShiftMonthContent, ShiftDayDetail } from "../components/ShiftSchedule";
import { BottomSheet } from "../components/BottomSheet";
import { useAuth } from "../AuthContext";
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
  const [requestDirty, setRequestDirty] = useState(false);
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
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: subTab === tab.id }}
              className={`flex-1 items-center py-2.5 border-b-2 ${subTab === tab.id ? "border-brand-900" : "border-transparent"}`}
              onPress={() => { if (tab.id === subTab) return; if (requestDirty) Alert.alert("変更を破棄しますか？", "希望休の変更はまだ提出されていません。", [{ text: "編集を続ける", style: "cancel" }, { text: "破棄して移動", style: "destructive", onPress: () => setSubTab(tab.id) }]); else setSubTab(tab.id); }}
            >
              <Text className={`text-sm font-medium ${subTab === tab.id ? "text-brand-900" : "text-brand-400"}`}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {subTab === "view" ? <ShiftConfirmView /> : <ShiftRequestView onDirtyChange={setRequestDirty} />}
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View className="flex-row items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
      <AppIcon name="triangle-exclamation" size={12} color="#b91c1c" iconStyle="solid" />
      <Text className="text-red-700 text-[13px] flex-1">{message}</Text>
    </View>
  );
}

// ------------------------------------------------------------
// シフト確認タブ
// ------------------------------------------------------------

// 月・本人の変更ごとに再取得し、前月/別ユーザーの予定を表示しない。


function ShiftConfirmView() {
  const [month, setMonth] = useState<YM>(nowYearMonth1);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <ScrollView className="flex-1" contentContainerClassName="pt-1 pb-10">
      <MonthTitle large ym={month} onPress={() => setPickerOpen(true)} />
      <MonthPager
        ym={month}
        onChange={setMonth}
        renderMonth={(m, isCenter) => (
          <View className="px-4 pt-1">
            {isCenter ? <ShiftMonthGrid key={ymKey(m)} ym={m} /> : <PlainMonthGrid ym={m} />}
          </View>
        )}
      />
      <MonthPickerSheet visible={pickerOpen} ym={month} onSelect={setMonth} onClose={() => setPickerOpen(false)} />
    </ScrollView>
  );
}

function ShiftMonthGrid({ ym }: { ym: YM }) {
  const { driver } = useAuth();
  const [data, setData] = useState<MeShiftsResponse | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const key = ymKey(ym);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setData(null); setSelected(null);
    const { start, end } = monthDateRange(ym.year, ym.month);
    apiFetch<MeShiftsResponse>(`/api/me/shifts?start=${start}&end=${end}`)
      .then(value => { if (alive) setData(value); })
      .catch(() => { if (alive) setError("シフトを取得できませんでした。"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key, driver.id, attempt]);
  if (loading) return <View style={{ padding: 48 }}><ActivityIndicator /></View>;
  if (error) return <View style={{ gap: 12 }}><ErrorBanner message={error} /><Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}><Text>再読み込み</Text></Pressable></View>;
  if (!data) return null;
  const restUnavailable = !data.rest_days || !!data.rest_days_unavailable;
  const rests = resolveMonthRests(ym.year, ym.month, data.shifts, data.rest_days ?? [], !restUnavailable);
  return <>
    <ShiftMonthContent year={ym.year} month={ym.month} shifts={data.shifts} rests={rests} today={toLocalDateStr(new Date())} restUnavailable={restUnavailable} onSelect={setSelected} />
    {restUnavailable && <Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ minHeight: 44, justifyContent: "center" }}><Text>再読み込み</Text></Pressable>}
    <BottomSheet visible={!!selected} scrollable onClose={() => setSelected(null)}>
      {selected && <ShiftDayDetail date={selected} shifts={data.shifts.filter(s => s.shift_date === selected)} rests={rests.filter(r => r.date === selected)} restUnavailable={restUnavailable} onClose={() => setSelected(null)} />}
    </BottomSheet>
  </>;
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

export function ShiftRequestView({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
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

  const generation = useRef(0), submitLock = useRef(false);
  const [ready, setReady] = useState(false), [success, setSuccess] = useState("");
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setReady(false); setError(""); setPickerDate(null);
    try {
      const [res, dl] = await Promise.all([
        apiFetch<{ requests: ShiftRequest[]; slots: DriverSlot[] }>(`/api/shifts/requests?month=${monthStr}`),
        apiFetch<{ periods: PeriodInfo[] }>(`/api/shifts/deadlines?month=${monthStr}`),
      ]);
      if (generation.current !== token) return;
      if (!res || !dl || !Array.isArray(res.requests) || !Array.isArray(res.slots) || !Array.isArray(dl.periods)) throw new Error("提出に必要な情報を取得できませんでした");
      setRequests(res.requests ?? []); setSlots(res.slots ?? []); setPeriods(dl.periods ?? []);
      setOff(requestsToOffMap(res.requests ?? [])); setReady(true);
    } catch (e) {
      if (generation.current === token) setError(e instanceof Error ? e.message : "シフト情報を取得できませんでした");
    } finally { if (generation.current === token) setLoading(false); }
  }, [monthStr]);
  useEffect(() => { setSuccess(""); void load(); return () => { generation.current++; }; }, [load]);
  const changed = ready && hasOffChanges(requests, off);
  useEffect(() => { onDirtyChange?.(changed || submitting); return () => onDirtyChange?.(false); }, [changed, submitting, onDirtyChange]);
  const changeMonth = (value: YM) => {
    if (submitting || (value.year === ym.year && value.month === ym.month)) return;
    const change = () => { setReady(false); setYm(value); };
    if (changed) Alert.alert("変更を破棄しますか？", "希望休の変更はまだ提出されていません。", [{ text: "編集を続ける", style: "cancel" }, { text: "破棄して移動", style: "destructive", onPress: change }]);
    else change();
  };

  const toggle = (dateStr: string, key: string) => { if (!ready || submitting || isLockedDate(periods, dateStr) || dateStr < toLocalDateStr(new Date())) return; setSuccess(""); setOff(prev => toggleOffKey(prev, dateStr, key)); };

  const onDayPress = (date: Date) => {
    const dateStr = toLocalDateStr(date);
    if (isLockedDate(periods, dateStr)) return;
    if (slots.length === 0) toggle(dateStr, ALL);
    else setPickerDate(dateStr);
  };

  const submit = async () => {
    if (!ready || !changed || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const offEntries = buildOffEntries(off, monthStr, periods);
      await apiFetch("/api/shifts/requests", {
        method: "POST",
        body: JSON.stringify({ month: monthStr, offEntries }),
      });
      setSuccess("希望休を提出しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出に失敗しました");
    } finally {
      submitLock.current = false; setSubmitting(false);
    }
  };

  const todayStr = toLocalDateStr(new Date());

  const slotName = (id: string) => slots.find((s) => s.id === id)?.name ?? "便";
  const selectedDates = [...off.keys()].filter((d) => d.startsWith(monthStr) && dayOff(off, d).size > 0).sort();

  return (
    <ScrollView testID="shift-request-view" className="flex-1" contentContainerClassName="pt-2 pb-10 gap-4">
      <View className="px-4">
        <Text className="text-[13px] text-brand-500">希望休を選択</Text>
      </View>

      <MonthTitle large ym={ym} onPress={() => !submitting && setPickerOpen(true)} />

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
                    <AppIcon name="lock" size={9} color="#7c848f" iconStyle="solid" />
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
        onChange={changeMonth}
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
                      const disabled = locked || past || submitting || !ready;
                      const box = whole
                        ? "bg-red-100 border-red-300"
                        : partial
                          ? "bg-red-50 border-red-300"
                          : "bg-white border-brand-100";
                      return (
                        <Pressable
                          key={dateStr}
                          testID={`request-day-${dateStr}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${shiftDateLabel(dateStr)}${whole ? "、全休" : partial ? "、便ごとの希望休" : ""}${locked ? "、受付終了" : ""}`}
                          accessibilityState={{ selected: whole || partial, disabled }}
                          style={COL}
                          className={`${CELL} rounded-lg border ${box} ${disabled ? "opacity-40" : ""}`}
                          onPress={() => !disabled && onDayPress(date)}
                          disabled={disabled}
                        >
                          <Text className={`text-sm ${whole ? "text-red-700 font-bold" : "text-brand-900"}`}>{date.getDate()}</Text>
                          {whole ? (
                            <AppIcon name="xmark" size={11} color="#b91c1c" iconStyle="solid" />
                          ) : partial ? (
                            <Text className="text-[9px] text-red-700 font-bold">便{dayOff(off, dateStr).size}</Text>
                          ) : locked ? (
                            <AppIcon name="lock" size={9} color="#a9b0b8" iconStyle="solid" />
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
        {success ? <Text accessibilityLiveRegion="polite" style={{ color: "#167047", fontSize: 15 }}>{success}</Text> : null}
        {!ready && !loading && <Pressable accessibilityRole="button" onPress={() => { void load(); }} style={{ minHeight: 48, justifyContent: "center" }}><Text>再読み込み</Text></Pressable>}

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
              <Text className="text-xs text-brand-500">便ごとの休み</Text>
            </View>
          )}
        </View>

        {changed && (
          <Pressable
            className={`bg-brand-600 py-3.5 rounded-lg items-center active:opacity-80 ${submitting ? "opacity-50" : ""}`}
            testID="submit-shift-requests"
            accessibilityRole="button"
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

      <MonthPickerSheet visible={pickerOpen} ym={ym} onSelect={changeMonth} onClose={() => setPickerOpen(false)} />

      {/* 便ピッカー */}
      <Modal visible={!!pickerDate} transparent animationType="fade" onRequestClose={() => setPickerDate(null)}>
        <View className="flex-1 bg-black/40 justify-center p-6">
          <Pressable accessibilityRole="button" accessibilityLabel="選択を閉じる" style={{ position: "absolute", inset: 0 }} onPress={() => setPickerDate(null)} />
          <View style={{ position: "relative" }} className="bg-white rounded-xl p-5 gap-2.5">
            <Text className="text-base font-bold text-brand-900">{pickerDate ? shiftDateLabel(pickerDate) : ""}</Text>
            <Text className="text-xs text-brand-500">全休、または休みたい便を選んでください。</Text>
            {pickerDate && (
              <>
                <Pressable
                  className={`py-3 rounded-lg border items-center ${dayOff(off, pickerDate).has(ALL) ? "bg-red-100 border-red-300" : "bg-white border-brand-200"}`}
                  testID="request-whole-day"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: dayOff(off, pickerDate).has(ALL) }}
                  accessibilityLabel="全休（1日休み）"
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
                        testID={`request-slot-${s.id}`}
                        accessibilityRole="checkbox"
                        accessibilityLabel={s.name}
                        accessibilityState={{ checked: on }}
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
            <Pressable testID="request-picker-done" accessibilityRole="button" className="mt-1 py-2.5 rounded-lg bg-brand-800 items-center" onPress={() => setPickerDate(null)}>
              <Text className="text-white text-sm font-medium">決定</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
