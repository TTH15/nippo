"use client";

import { useEffect, useState, useMemo } from "react";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faLock } from "@fortawesome/free-solid-svg-icons";
import { VehiclePlate } from "@/lib/components/VehiclePlate";

type ShiftRequest = {
  id: string;
  driver_id: string;
  request_date: string;
  request_type: string;
  slot_id: string | null;
};

type DriverSlot = { id: string; name: string; carrierId: string };

const ALL = "ALL"; // 全休を表すキー

type PeriodInfo = {
  seq: number;
  label: string; // "1〜15" 等
  deadline: string; // YYYY-MM-DD
  closed: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

type MeShiftVehicle = {
  id: string;
  number_prefix: string | null;
  number_class: string | null;
  number_hiragana: string | null;
  number_numeric: string | null;
  manufacturer: string | null;
  brand: string | null;
};

type MeShift = {
  shift_date: string;
  course_name: string;
  course_color: string | null;
  slot: number;
  vehicle: MeShiftVehicle | null;
};

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function currentMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

type SubTabId = "request" | "view";

const SUB_TABS: { id: SubTabId; label: string }[] = [
  { id: "view", label: "シフト確認" },
  { id: "request", label: "希望休提出" },
];

export default function ShiftsPage() {
  const [subTab, setSubTab] = useState<SubTabId>("view");

  const [viewDate, setViewDate] = useState(currentMonth);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 希望休の選択。date → { "ALL"（全休） or slotId } の集合。
  const [off, setOff] = useState<Map<string, Set<string>>>(new Map());
  const [slots, setSlots] = useState<DriverSlot[]>([]);
  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);

  const [shiftMonth, setShiftMonth] = useState(() => currentYearMonth());
  const [shifts, setShifts] = useState<MeShift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  const days = useMemo(() => getDaysInMonth(viewDate.year, viewDate.month), [viewDate]);
  const monthStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, "0")}`;

  const shiftViewDays = useMemo(
    () => getDaysInMonth(shiftMonth.year, shiftMonth.month - 1),
    [shiftMonth]
  );
  const shiftViewFirstDow = new Date(shiftMonth.year, shiftMonth.month - 1, 1).getDay();
  const shiftViewEmptyCells = Array(shiftViewFirstDow).fill(null);
  const shiftsByDate = useMemo(() => {
    const m = new Map<string, MeShift[]>();
    shifts.forEach((s) => {
      const list = m.get(s.shift_date) ?? [];
      list.push(s);
      m.set(s.shift_date, list);
    });
    return m;
  }, [shifts]);

  const load = async () => {
    setLoading(true);
    try {
      const [res, dl] = await Promise.all([
        apiFetch<{ requests: ShiftRequest[]; slots: DriverSlot[] }>(`/api/shifts/requests?month=${monthStr}`),
        apiFetch<{ periods: PeriodInfo[] }>(`/api/shifts/deadlines?month=${monthStr}`).catch(() => null),
      ]);
      setRequests(res.requests ?? []);
      setSlots(res.slots ?? []);
      const m = new Map<string, Set<string>>();
      (res.requests ?? []).forEach((r) => {
        const key = r.slot_id ?? ALL;
        const s = m.get(r.request_date) ?? new Set<string>();
        s.add(key);
        m.set(r.request_date, s);
      });
      setOff(m);
      setPeriods(dl?.periods ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 指定日が属する提出期間（API値を信頼）。どの期間にも属さない＝ロックしない（常に提出可）。
  const periodFor = (dateStr: string): PeriodInfo | null => {
    for (const p of periods) if (dateStr >= p.startDate && dateStr <= p.endDate) return p;
    return null;
  };
  const isLockedDate = (dateStr: string): boolean => periodFor(dateStr)?.closed ?? false;

  useEffect(() => {
    if (subTab === "request") {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr, subTab]);

  useEffect(() => {
    if (subTab !== "view") return;
    const { year, month } = shiftMonth;
    setShiftsLoading(true);
    setShiftsError(null);
    const { start, end } = getMonthDateRange(year, month);
    apiFetch<{ shifts: MeShift[] }>(`/api/me/shifts?start=${start}&end=${end}`)
      .then((d) => setShifts(d.shifts ?? []))
      .catch((e: unknown) => {
        console.error(e);
        setShiftsError("シフトの取得に失敗しました");
      })
      .finally(() => setShiftsLoading(false));
  }, [shiftMonth, subTab]);

  const prevMonth = () => {
    setViewDate((v) => {
      if (v.month === 0) return { year: v.year - 1, month: 11 };
      return { ...v, month: v.month - 1 };
    });
  };

  const nextMonth = () => {
    setViewDate((v) => {
      if (v.month === 11) return { year: v.year + 1, month: 0 };
      return { ...v, month: v.month + 1 };
    });
  };

  const getDateStr = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const dayOff = (dateStr: string): Set<string> => off.get(dateStr) ?? new Set<string>();
  const isWholeDayOff = (dateStr: string) => dayOff(dateStr).has(ALL);
  const hasAnyOff = (dateStr: string) => dayOff(dateStr).size > 0;

  // 全休/便キーをトグル（全休と便は排他）。
  const toggleOffKey = (dateStr: string, key: string) => {
    setOff((prev) => {
      const next = new Map(prev);
      const s = new Set(next.get(dateStr) ?? []);
      if (key === ALL) {
        if (s.has(ALL)) s.delete(ALL);
        else {
          s.clear();
          s.add(ALL);
        }
      } else {
        s.delete(ALL);
        if (s.has(key)) s.delete(key);
        else s.add(key);
      }
      if (s.size === 0) next.delete(dateStr);
      else next.set(dateStr, s);
      return next;
    });
  };

  const toggleOffDay = (date: Date) => {
    const dateStr = getDateStr(date);
    if (isLockedDate(dateStr)) return; // 締切済み期間は変更不可
    if (slots.length === 0) toggleOffKey(dateStr, ALL); // 便なし＝全休トグル
    else setPickerDate(dateStr); // 便あり＝ピッカーを開く
  };

  const hasChanges = useMemo(() => {
    const serverKeys = new Set(requests.map((r) => `${r.request_date}#${r.slot_id ?? ALL}`));
    const curKeys: string[] = [];
    off.forEach((set, d) => set.forEach((k) => curKeys.push(`${d}#${k}`)));
    if (curKeys.length !== serverKeys.size) return true;
    for (const k of curKeys) if (!serverKeys.has(k)) return true;
    return false;
  }, [requests, off]);

  const submitOffDates = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const offEntries: { date: string; slotId: string | null }[] = [];
      off.forEach((set, d) => {
        if (!d.startsWith(monthStr) || isLockedDate(d)) return;
        set.forEach((k) => offEntries.push({ date: d, slotId: k === ALL ? null : k }));
      });
      await apiFetch("/api/shifts/requests", {
        method: "POST",
        body: JSON.stringify({ month: monthStr, offEntries }),
      });
      await load();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "シフト希望の保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、希望休を保存できませんでした。\n\n" +
          "通信状況を確認してから、もう一度「希望休を提出する」を押してください。\n" +
          "同じエラーが続く場合は、管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  const firstDayOfWeek = new Date(viewDate.year, viewDate.month, 1).getDay();
  const emptyCells = Array(firstDayOfWeek).fill(null);

  return (
    <>
      <div className="max-w-md mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-slate-900 mb-4">シフト</h1>

        {/* サブタブ: 希望休提出 / シフト確認 */}
        <div className="flex border-b border-slate-200 mb-6">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === tab.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 希望休提出 */}
        {subTab === "request" && (
          <>
            <p className="text-sm text-slate-500 mb-5">
              休みを希望する日をタップして選択し、「希望休を提出する」でまとめて送信します
            </p>

            <div className="flex items-center justify-between mb-4">
              <button
                onClick={prevMonth}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                ← 前月
              </button>
              <h2 className="text-base font-semibold text-slate-900">
                {viewDate.year}年 {monthNames[viewDate.month]}
              </h2>
              <button
                onClick={nextMonth}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                翌月 →
              </button>
            </div>

            {periods.length > 0 && (
              <div className="mb-4 grid grid-cols-2 gap-2">
                {periods.map((p) => {
                  const [, dm, dd] = p.deadline.split("-").map(Number);
                  return (
                    <div
                      key={p.seq}
                      className={`rounded border px-3 py-2 text-xs ${
                        p.closed
                          ? "border-slate-200 bg-slate-50 text-slate-400"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      <div className="font-medium text-slate-600">{p.label}日</div>
                      <div className="mt-0.5">
                        締切 {dm}/{dd}
                        {p.closed ? (
                          <span className="ml-1 inline-flex items-center gap-1 font-semibold text-slate-500">
                            <FontAwesomeIcon icon={faLock} className="w-2.5 h-2.5" />
                            受付終了
                          </span>
                        ) : (
                          <span className="ml-1 font-semibold text-emerald-700">受付中</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {loading ? (
              <div className="bg-white rounded border border-slate-200 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {[...Array(7)].map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full max-w-[2rem] mx-auto" />
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {[...Array(35)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square w-full rounded" />
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded border border-slate-200 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {dayNames.map((name, i) => (
                    <div
                      key={name}
                      className={`text-center text-xs font-medium py-1.5 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}
                    >
                      {name}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {emptyCells.map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                  ))}
                  {days.map((date) => {
                    const dateStr = getDateStr(date);
                    const isPast = date < today;
                    const locked = isLockedDate(dateStr);
                    const whole = isWholeDayOff(dateStr);
                    const partial = !whole && hasAnyOff(dateStr);
                    const dayOfWeek = date.getDay();
                    const isToday = date.toDateString() === today.toDateString();
                    const disabled = isPast || locked;
                    return (
                      <button
                        key={dateStr}
                        onClick={(e) => {
                          if (!disabled) {
                            toggleOffDay(date);
                            (e.currentTarget as HTMLElement).blur();
                          }
                        }}
                        disabled={disabled}
                        title={locked ? "締切を過ぎたため変更できません" : undefined}
                        className={`
                          aspect-square rounded flex flex-col items-center justify-center text-sm font-medium
                          transition-colors relative outline-none focus:outline-none
                          ${locked ? "opacity-60 cursor-not-allowed bg-slate-100" : isPast ? "opacity-30 cursor-not-allowed" : "cursor-pointer hover:bg-slate-100"}
                          ${whole ? "bg-red-100 border border-red-300" : partial ? "bg-red-50 border border-red-300" : locked ? "" : "bg-slate-50"}
                          ${isToday ? "ring-2 ring-slate-400" : ""}
                        `}
                      >
                        <span className={dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : "text-slate-700"}>
                          {date.getDate()}
                        </span>
                        {whole && (
                          <span className="text-red-500 font-bold absolute">
                            <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
                          </span>
                        )}
                        {partial && (
                          <span className="absolute bottom-0.5 text-[9px] font-bold text-red-500 leading-none">
                            便{dayOff(dateStr).size}
                          </span>
                        )}
                        {locked && !whole && !partial && (
                          <FontAwesomeIcon icon={faLock} className="w-2.5 h-2.5 text-slate-400 absolute bottom-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 bg-red-100 border border-red-300 rounded flex items-center justify-center">
                  <span className="text-red-500 text-[10px] font-bold">×</span>
                </div>
                <span>全休</span>
              </div>
              {slots.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 bg-red-50 border border-red-300 rounded flex items-center justify-center">
                    <span className="text-red-500 text-[8px] font-bold">便</span>
                  </div>
                  <span>便のみ希望（タップで選択）</span>
                </div>
              )}
            </div>

            {!loading && hasChanges && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={submitOffDates}
                  disabled={saving}
                  className="w-full py-3 bg-brand-600 text-white font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "送信中..." : "希望休を提出する"}
                </button>
              </div>
            )}

            {(() => {
              const dates = [...off.keys()].filter((d) => d.startsWith(monthStr)).sort();
              if (dates.length === 0) return null;
              const slotName = (id: string) => slots.find((s) => s.id === id)?.name ?? "便";
              return (
                <div className="mt-4 bg-slate-50 rounded border border-slate-200 p-3">
                  <h3 className="text-sm font-medium text-slate-700 mb-2">
                    {monthNames[viewDate.month]}の希望休: {dates.length}日
                  </h3>
                  <div className="flex flex-col gap-1">
                    {dates.map((dateStr) => {
                      const [y, m, d] = dateStr.split("-").map(Number);
                      const localDate = new Date(y, m - 1, d);
                      const set = dayOff(dateStr);
                      const detail = set.has(ALL) ? "全休" : [...set].map(slotName).join("・");
                      return (
                        <div key={dateStr} className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded tabular-nums">
                            {localDate.getMonth() + 1}/{localDate.getDate()}({dayNames[localDate.getDay()]})
                          </span>
                          <span className="text-slate-500">{detail}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* 便ピッカー */}
            {pickerDate && (() => {
              const [y, m, d] = pickerDate.split("-").map(Number);
              const localDate = new Date(y, m - 1, d);
              const set = dayOff(pickerDate);
              return (
                <div
                  className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4"
                  onClick={() => setPickerDate(null)}
                >
                  <div className="bg-white rounded-xl shadow-lg w-full max-w-xs p-4" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-sm font-semibold text-slate-900 mb-1">
                      {localDate.getMonth() + 1}/{localDate.getDate()}({dayNames[localDate.getDay()]}) の希望休
                    </h3>
                    <p className="text-xs text-slate-500 mb-3">全休、または休みたい便を選んでください。</p>
                    <button
                      type="button"
                      onClick={() => toggleOffKey(pickerDate, ALL)}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-medium mb-2 ${
                        set.has(ALL)
                          ? "bg-red-100 border-red-300 text-red-700"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      全休（1日休み）
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      {slots.map((s) => {
                        const on = set.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleOffKey(pickerDate, s.id)}
                            className={`px-3 py-2 rounded-lg border text-sm font-medium ${
                              on
                                ? "bg-red-100 border-red-300 text-red-700"
                                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setPickerDate(null)}
                      className="mt-4 w-full py-2 bg-slate-800 text-white text-sm font-medium rounded-lg"
                    >
                      決定
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* シフト確認（カレンダー） */}
        {subTab === "view" && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() =>
                  setShiftMonth((m) => {
                    if (m.month === 1) return { year: m.year - 1, month: 12 };
                    return { ...m, month: m.month - 1 };
                  })
                }
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                ← 前月
              </button>
              <div className="text-sm font-medium text-slate-900">
                {shiftMonth.year}年 {shiftMonth.month}月
              </div>
              <button
                type="button"
                onClick={() =>
                  setShiftMonth((m) => {
                    if (m.month === 12) return { year: m.year + 1, month: 1 };
                    return { ...m, month: m.month + 1 };
                  })
                }
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                翌月 →
              </button>
            </div>
            {shiftsLoading ? (
              <div className="bg-white rounded border border-slate-200 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {dayNames.map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full max-w-[2rem] mx-auto" />
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {[...Array(35)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square w-full rounded min-h-[3.5rem]" />
                  ))}
                </div>
              </div>
            ) : shiftsError ? (
              <p className="text-sm text-red-600">{shiftsError}</p>
            ) : (
              <div className="bg-white rounded border border-slate-300 overflow-hidden">
                <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-300">
                  {dayNames.map((name, i) => (
                    <div
                      key={name}
                      className={`text-center text-xs font-medium py-1.5 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}
                    >
                      {name}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-px bg-slate-300">
                  {shiftViewEmptyCells.map((_, i) => (
                    <div key={`empty-${i}`} className="min-h-[5rem] bg-slate-50" />
                  ))}
                  {shiftViewDays.map((date) => {
                    const dateStr = getDateStr(date);
                    const dayShifts = shiftsByDate.get(dateStr) ?? [];
                    const dayOfWeek = date.getDay();
                    const isToday = date.toDateString() === today.toDateString();
                    const uniqueVehicles = Array.from(
                      new Map(
                        dayShifts
                          .map((s) => s.vehicle)
                          .filter((v): v is MeShiftVehicle => v != null)
                          .map((v) => [v.id, v] as const),
                      ).values(),
                    );
                    return (
                      <div
                        key={dateStr}
                        className={`min-h-[5rem] bg-white flex flex-col p-1 ${isToday ? "ring-2 ring-slate-400 ring-inset" : ""}`}
                      >
                        <span
                          className={`text-xs font-medium shrink-0 self-center ${dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : "text-slate-700"}`}
                        >
                          {date.getDate()}
                        </span>
                        <div className="flex flex-wrap gap-0.5 overflow-hidden">
                          {dayShifts.map((s, idx) => (
                            <span
                              key={`${s.shift_date}-${s.course_name}-${idx}`}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-full"
                              style={
                                s.course_color
                                  ? { backgroundColor: s.course_color, color: "#ffffff" }
                                  : { backgroundColor: "#e2e8f0", color: "#475569" }
                              }
                              title={s.course_name || ""}
                            >
                              {s.course_name || "-"}
                            </span>
                          ))}
                        </div>
                        {uniqueVehicles.length > 0 && (
                          <div className="mt-auto flex flex-col items-center gap-0.5 pt-0.5">
                            {uniqueVehicles.map((v) => {
                              const fullPlate = [
                                v.number_prefix,
                                v.number_class,
                                v.number_hiragana,
                                v.number_numeric,
                              ]
                                .filter(Boolean)
                                .join(" ");
                              return (
                                <div
                                  key={v.id}
                                  className="w-full"
                                  title={fullPlate || undefined}
                                >
                                  <VehiclePlate vehicle={v} compact glow={false} />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
    </>
  );
}
