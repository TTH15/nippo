"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

type Course = { id: string; name: string; color: string; sort_order: number };
type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
  driver_courses: { course_id: string }[];
};
type Shift = {
  id: string;
  shift_date: string;
  course_id: string;
  driver_id: string | null;
  drivers: { id: string; name: string; display_name?: string | null } | null;
};
type ShiftRequest = {
  id: string;
  driver_id: string;
  request_date: string;
  request_type: string;
};

/** 指定月の前半（1日〜15日）の日付リスト */
function getFirstHalfDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const endDay = Math.min(15, new Date(year, month, 0).getDate());
  for (let day = 1; day <= endDay; day++) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

/** 指定月の後半（16日〜月末）の日付リスト */
function getSecondHalfDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const lastDay = new Date(year, month, 0).getDate();
  for (let day = 16; day <= lastDay; day++) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

type Period = "first" | "second";

export default function ShiftsPage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [period, setPeriod] = useState<Period>("first");
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // ローカルの変更を管理
  const [localShifts, setLocalShifts] = useState<Map<string, string | null>>(new Map());
  const [hasChanges, setHasChanges] = useState(false);

  const displayDates = useMemo(
    () =>
      period === "first"
        ? getFirstHalfDates(yearMonth.year, yearMonth.month)
        : getSecondHalfDates(yearMonth.year, yearMonth.month),
    [yearMonth.year, yearMonth.month, period]
  );

  const load = useCallback(async () => {
    if (displayDates.length === 0) return;
    setLoading(true);
    const start = displayDates[0];
    const end = displayDates[displayDates.length - 1];
    try {
      const res = await apiFetch<{
        courses: Course[];
        drivers: Driver[];
        shifts: Shift[];
        requests: ShiftRequest[];
      }>(`/api/admin/shifts?start=${start}&end=${end}`);
      setCourses(res.courses);
      setDrivers(res.drivers);
      setShifts(res.shifts);
      setRequests(res.requests);
      setLocalShifts(new Map());
      setHasChanges(false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [displayDates]);

  useEffect(() => {
    load();
  }, [load]);

  const prevMonth = () => {
    if (hasChanges && !confirm("変更が保存されていません。破棄しますか？")) return;
    setYearMonth((prev) => {
      if (prev.month === 1) return { year: prev.year - 1, month: 12 };
      return { year: prev.year, month: prev.month - 1 };
    });
  };

  const nextMonth = () => {
    if (hasChanges && !confirm("変更が保存されていません。破棄しますか？")) return;
    setYearMonth((prev) => {
      if (prev.month === 12) return { year: prev.year + 1, month: 1 };
      return { year: prev.year, month: prev.month + 1 };
    });
  };

  const switchPeriod = (p: Period) => {
    if (hasChanges && !confirm("変更が保存されていません。破棄しますか？")) return;
    setPeriod(p);
  };

  const generateDraft = async () => {
    if (displayDates.length === 0) return;
    if (
      !confirm(
        "この期間のシフトを希望休・配送可能ルートに基づいて自動で叩き台生成します。既存の割り当ては上書きされます。実行しますか？"
      )
    )
      return;
    setGenerating(true);
    try {
      const start = displayDates[0];
      const end = displayDates[displayDates.length - 1];
      const res = await apiFetch<{ applied: number; total: number }>(
        "/api/admin/shifts/generate-draft",
        {
          method: "POST",
          body: JSON.stringify({ start, end }),
        }
      );
      await load();
      alert(`叩き台を生成しました（${res.applied}/${res.total} 件割当）`);
    } catch (e) {
      console.error(e);
      alert("叩き台の生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  const getCellKey = (date: string, courseId: string) => `${date}:${courseId}`;

  // 現在のドライバーIDを取得（ローカル変更 > サーバーデータ）
  const getCurrentDriverId = (date: string, courseId: string): string | null => {
    const key = getCellKey(date, courseId);
    if (localShifts.has(key)) {
      return localShifts.get(key) ?? null;
    }
    const shift = shifts.find((s) => s.shift_date === date && s.course_id === courseId);
    return shift?.driver_id ?? null;
  };

  // その日に既に割り当てられているドライバーIDを取得
  const getAssignedDriversOnDate = (date: string, excludeCourseId?: string): Set<string> => {
    const assigned = new Set<string>();
    
    // サーバーのシフトデータ
    shifts.forEach((s) => {
      if (s.shift_date === date && s.driver_id && s.course_id !== excludeCourseId) {
        assigned.add(s.driver_id);
      }
    });
    
    // ローカルの変更を反映
    localShifts.forEach((driverId, key) => {
      const [keyDate, keyCourseId] = key.split(":");
      if (keyDate === date && keyCourseId !== excludeCourseId && driverId) {
        assigned.add(driverId);
      }
    });
    
    return assigned;
  };

  // ドライバーが希望休かどうか
  const isDriverOffDay = (driverId: string, date: string) => {
    return requests.some((r) => r.driver_id === driverId && r.request_date === date);
  };

  // ドライバーがコースを担当できるか
  const canDriverHandleCourse = (driverId: string, courseId: string) => {
    const driver = drivers.find((d) => d.id === driverId);
    if (!driver) return false;
    return driver.driver_courses.some((dc) => dc.course_id === courseId);
  };

  // 特定のセルで選択可能なドライバーリストを取得
  const getAvailableDrivers = (date: string, courseId: string) => {
    const assignedOnDate = getAssignedDriversOnDate(date, courseId);
    const currentDriverId = getCurrentDriverId(date, courseId);
    
    return drivers.filter((driver) => {
      // 現在割り当てられているドライバーは常に表示
      if (driver.id === currentDriverId) return true;
      // コースを担当できるか
      if (!canDriverHandleCourse(driver.id, courseId)) return false;
      // 希望休か
      if (isDriverOffDay(driver.id, date)) return false;
      // 同日他コースに割り当て済みか
      if (assignedOnDate.has(driver.id)) return false;
      return true;
    });
  };

  // ローカルでドライバーを割り当て
  const setLocalDriver = (date: string, courseId: string, driverId: string | null) => {
    const key = getCellKey(date, courseId);
    setLocalShifts((prev) => {
      const next = new Map(prev);
      next.set(key, driverId);
      return next;
    });
    setHasChanges(true);
  };

  // 一括保存
  const saveAll = async () => {
    if (localShifts.size === 0) return;
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];
      localShifts.forEach((driverId, key) => {
        const [date, courseId] = key.split(":");
        promises.push(
          apiFetch("/api/admin/shifts", {
            method: "POST",
            body: JSON.stringify({ shiftDate: date, courseId, driverId }),
          })
        );
      });
      await Promise.all(promises);
      await load();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (!confirm("変更を破棄しますか？")) return;
    setLocalShifts(new Map());
    setHasChanges(false);
  };

  const getDriverRequests = (driverId: string) => {
    return requests.filter((r) => r.driver_id === driverId);
  };

  /** その日に休みの人（その日いずれのコースにも割り当てられていない人）の名前リスト */
  const getOffDriverNamesOnDate = (date: string): string[] => {
    const assignedOnDate = new Set<string>();
    courses.forEach((course) => {
      const driverId = getCurrentDriverId(date, course.id);
      if (driverId) assignedOnDate.add(driverId);
    });
    return drivers
      .filter((d) => !assignedOnDate.has(d.id))
      .map((d) => getDisplayName(d))
      .sort();
  };

  return (
    <AdminLayout>
      <div className="max-w-full">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-xl font-bold text-slate-900">シフト管理</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => switchPeriod("first")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  period === "first"
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                前半（1〜15日）
              </button>
              <button
                type="button"
                onClick={() => switchPeriod("second")}
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-slate-200 ${
                  period === "second"
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                後半（16日〜）
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={prevMonth}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                ← 前月
              </button>
              <span className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded">
                {yearMonth.year}年{yearMonth.month}月
              </span>
              <button
                onClick={nextMonth}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                翌月 →
              </button>
            </div>
            <button
              type="button"
              onClick={generateDraft}
              disabled={loading || generating || displayDates.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? "生成中..." : "叩き台を生成"}
            </button>
          </div>
        </div>

        {/* 保存バー */}
        {hasChanges && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded flex items-center justify-between">
            <span className="text-sm font-medium text-amber-800">
              {localShifts.size}件の未保存の変更
            </span>
            <div className="flex gap-2">
              <button
                onClick={discardChanges}
                className="px-3 py-1 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                破棄
              </button>
              <button
                onClick={saveAll}
                disabled={saving}
                className="px-4 py-1 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-0">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-2 px-2 text-left w-28 sticky left-0 bg-slate-50 z-10">
                    <Skeleton className="h-4 w-14" />
                  </th>
                  {[...Array(14)].map((_, i) => (
                    <th key={i} className="py-2 px-0.5 min-w-[4rem]">
                      <Skeleton className="h-4 w-8 mx-auto" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 px-2 sticky left-0 bg-white z-10">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    {[...Array(14)].map((_, j) => (
                      <td key={j} className="py-1 px-0.5">
                        <Skeleton className="h-6 w-full max-w-[3rem] mx-auto" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white rounded border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-0">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-2 px-2 text-left font-medium text-slate-600 w-28 sticky left-0 bg-slate-50 z-10">
                    コース
                  </th>
                  {displayDates.map((date) => {
                    const d = new Date(date);
                    const dayOfWeek = d.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    return (
                      <th
                        key={date}
                        className={`py-2 px-0.5 text-center font-medium min-w-[4rem] ${
                          isWeekend ? "text-red-600 bg-red-50" : "text-slate-600"
                        }`}
                      >
                        {formatDate(date)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="border-b border-slate-100 last:border-b-0">
                    <td
                      className="py-1 px-2 font-medium text-slate-800 sticky left-0 bg-white z-10 border-l-4"
                      style={{ borderLeftColor: course.color }}
                    >
                      {course.name}
                    </td>
                    {displayDates.map((date) => {
                      const currentDriverId = getCurrentDriverId(date, course.id);
                      const d = new Date(date);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const key = getCellKey(date, course.id);
                      const isModified = localShifts.has(key);
                      
                      const availableDrivers = getAvailableDrivers(date, course.id);
                      const hasNoOptions = !currentDriverId && availableDrivers.length === 0;

                      return (
                        <td
                          key={date}
                          className={`py-1 px-0.5 ${isWeekend ? "bg-red-50/30" : ""}`}
                        >
                          <select
                            value={currentDriverId ?? ""}
                            onChange={(e) =>
                              setLocalDriver(date, course.id, e.target.value || null)
                            }
                            className={`w-full min-w-0 text-xs py-1 px-1.5 rounded border transition-colors cursor-pointer
                              appearance-none focus:outline-none focus:ring-1 focus:ring-slate-400
                              [&:not([value=""])]:font-medium
                              ${hasNoOptions
                                ? "border-red-400 bg-red-50 text-red-700"
                                : isModified 
                                  ? "border-amber-400 bg-amber-50 text-slate-800" 
                                  : currentDriverId 
                                    ? "border-slate-300 bg-slate-50 text-slate-800" 
                                    : "border-slate-200 bg-white text-slate-500"
                              }
                            `}
                            style={{ backgroundImage: "none" }}
                          >
                            <option value="">—</option>
                            {availableDrivers.map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {getDisplayName(driver)}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* 休み：日付ごとにその日休みの人を表示 */}
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="py-1 px-2 font-medium text-slate-700 sticky left-0 bg-slate-50 z-10">
                    休み
                  </td>
                  {displayDates.map((date) => {
                    const names = getOffDriverNamesOnDate(date);
                    return (
                      <td
                        key={date}
                        className="py-1 px-0.5 text-xs text-slate-600 align-top min-w-[4rem]"
                      >
                        {names.length > 0 ? (
                          <div className="flex flex-wrap gap-0.5">
                            {names.map((name) => (
                              <span
                                key={name}
                                className="inline-block px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* 希望休 */}
        <div className="mt-6 bg-white rounded border border-slate-200 p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-3">この期間の希望休</h3>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {drivers.map((driver) => {
              const driverReqs = getDriverRequests(driver.id);
              if (driverReqs.length === 0) return null;
              return (
                <div key={driver.id} className="flex items-center gap-2 text-sm">
                  <span className="text-slate-700">{getDisplayName(driver)}:</span>
                  <div className="flex gap-1">
                    {driverReqs.map((r) => (
                      <span
                        key={r.id}
                        className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs"
                      >
                        {formatDate(r.request_date)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {requests.length === 0 && (
              <p className="text-sm text-slate-400">この期間の希望休はありません</p>
            )}
          </div>
        </div>

        {/* 凡例 */}
        <div className="mt-3 flex gap-6 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 border-2 border-red-400 bg-red-50 rounded"></div>
            <span>割当不可</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 border border-amber-400 bg-amber-50 rounded"></div>
            <span>未保存</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 border border-slate-300 bg-slate-50 rounded"></div>
            <span>割当済</span>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
