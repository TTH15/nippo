"use client";

import { useEffect, useState, useMemo } from "react";
import { Nav } from "@/lib/components/Nav";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";

type ShiftRequest = {
  id: string;
  driver_id: string;
  request_date: string;
  request_type: string;
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

export default function ShiftsPage() {
  const [viewDate, setViewDate] = useState(currentMonth);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const days = useMemo(() => getDaysInMonth(viewDate.year, viewDate.month), [viewDate]);
  const monthStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, "0")}`;

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ requests: ShiftRequest[] }>(`/api/shifts/requests?month=${monthStr}`);
      setRequests(res.requests);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

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

  const isOffDay = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return requests.some((r) => r.request_date === dateStr);
  };

  const toggleOffDay = async (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    const isCurrentlyOff = isOffDay(date);
    setSaving(dateStr);

    try {
      await apiFetch("/api/shifts/requests", {
        method: "POST",
        body: JSON.stringify({ date: dateStr, isOff: !isCurrentlyOff }),
      });
      await load();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setSaving(null);
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
      <Nav />
      <div className="max-w-md mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-slate-900 mb-1">シフト希望</h1>
        <p className="text-sm text-slate-500 mb-5">
          休みを希望する日をタップしてください
        </p>

        {/* Month navigation */}
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
            {/* Day names header */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {dayNames.map((name, i) => (
                <div
                  key={name}
                  className={`text-center text-xs font-medium py-1.5 ${
                    i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-500"
                  }`}
                >
                  {name}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {emptyCells.map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square" />
              ))}

              {days.map((date) => {
                const isPast = date < today;
                const isOff = isOffDay(date);
                const isSaving = saving === date.toISOString().split("T")[0];
                const dayOfWeek = date.getDay();
                const isToday = date.toDateString() === today.toDateString();

                return (
                  <button
                    key={date.toISOString()}
                    onClick={() => !isPast && toggleOffDay(date)}
                    disabled={isPast || isSaving}
                    className={`
                      aspect-square rounded flex flex-col items-center justify-center text-sm font-medium
                      transition-colors relative
                      ${isPast ? "opacity-30 cursor-not-allowed" : "cursor-pointer hover:bg-slate-100"}
                      ${isOff ? "bg-red-100 border border-red-300" : "bg-slate-50"}
                      ${isToday ? "ring-2 ring-slate-400" : ""}
                    `}
                  >
                    <span className={dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : "text-slate-700"}>
                      {date.getDate()}
                    </span>
                    {isOff && (
                      <span className="text-red-500 text-xs font-bold absolute">×</span>
                    )}
                    {isSaving && (
                      <span className="absolute inset-0 flex items-center justify-center bg-white/80 rounded">
                        <span className="text-xs text-slate-400">...</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-red-100 border border-red-300 rounded flex items-center justify-center">
              <span className="text-red-500 text-[10px] font-bold">×</span>
            </div>
            <span>希望休</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-slate-50 rounded" />
            <span>出勤可能</span>
          </div>
        </div>

        {/* Summary */}
        {requests.length > 0 && (
          <div className="mt-4 bg-slate-50 rounded border border-slate-200 p-3">
            <h3 className="text-sm font-medium text-slate-700 mb-2">
              {monthNames[viewDate.month]}の希望休: {requests.length}日
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {requests
                .sort((a, b) => a.request_date.localeCompare(b.request_date))
                .map((r) => {
                  const d = new Date(r.request_date);
                  return (
                    <span
                      key={r.id}
                      className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 text-xs rounded"
                    >
                      {d.getMonth() + 1}/{d.getDate()}({dayNames[d.getDay()]})
                    </span>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
