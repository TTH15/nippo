"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";

type Course = { id: string; name: string; color: string; sort_order: number };
type Driver = {
  id: string;
  name: string;
  driver_courses: { course_id: string }[];
};
type Shift = {
  id: string;
  shift_date: string;
  course_id: string;
  driver_id: string | null;
  drivers: { id: string; name: string } | null;
};
type ShiftRequest = {
  id: string;
  driver_id: string;
  request_date: string;
  request_type: string;
};

function getWeekDates(startDate: Date): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

export default function ShiftsPage() {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getMonday(new Date()));
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ローカルの変更を管理
  const [localShifts, setLocalShifts] = useState<Map<string, string | null>>(new Map());
  const [hasChanges, setHasChanges] = useState(false);

  const weekDates = useMemo(() => getWeekDates(currentWeekStart), [currentWeekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    const start = weekDates[0];
    const end = weekDates[6];
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
  }, [weekDates]);

  useEffect(() => {
    load();
  }, [load]);

  const prevWeek = () => {
    if (hasChanges && !confirm("変更が保存されていません。破棄しますか？")) return;
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - 7);
    setCurrentWeekStart(d);
  };

  const nextWeek = () => {
    if (hasChanges && !confirm("変更が保存されていません。破棄しますか？")) return;
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + 7);
    setCurrentWeekStart(d);
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

  return (
    <AdminLayout>
      <div className="max-w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">シフト管理</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={prevWeek}
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              ← 前週
            </button>
            <span className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded">
              {weekDates[0]} 〜 {weekDates[6]}
            </span>
            <button
              onClick={nextWeek}
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              翌週 →
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
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : (
          <div className="bg-white rounded border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-2.5 px-3 text-left font-medium text-slate-600 w-36 sticky left-0 bg-slate-50 z-10">
                    コース
                  </th>
                  {weekDates.map((date) => {
                    const d = new Date(date);
                    const dayOfWeek = d.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    return (
                      <th
                        key={date}
                        className={`py-2.5 px-1 text-center font-medium min-w-[110px] ${
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
                      className="py-2 px-3 font-medium text-slate-800 sticky left-0 bg-white z-10 border-l-4"
                      style={{ borderLeftColor: course.color }}
                    >
                      {course.name}
                    </td>
                    {weekDates.map((date) => {
                      const currentDriverId = getCurrentDriverId(date, course.id);
                      const d = new Date(date);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const key = getCellKey(date, course.id);
                      const isModified = localShifts.has(key);
                      
                      const availableDrivers = getAvailableDrivers(date, course.id);
                      // 現在割り当てられていて、かつ選択可能なドライバーがいない場合を除外
                      const hasNoOptions = !currentDriverId && availableDrivers.length === 0;

                      return (
                        <td
                          key={date}
                          className={`py-1.5 px-1 ${isWeekend ? "bg-red-50/30" : ""}`}
                        >
                          <select
                            value={currentDriverId ?? ""}
                            onChange={(e) =>
                              setLocalDriver(date, course.id, e.target.value || null)
                            }
                            className={`w-full text-xs py-1.5 px-2 rounded border transition-colors cursor-pointer
                              focus:outline-none focus:ring-1 focus:ring-slate-400
                              ${hasNoOptions
                                ? "border-red-400 bg-red-50 text-red-700"
                                : isModified 
                                  ? "border-amber-400 bg-amber-50 text-slate-800" 
                                  : currentDriverId 
                                    ? "border-slate-300 bg-slate-50 text-slate-800" 
                                    : "border-slate-200 bg-white text-slate-500"
                              }
                            `}
                          >
                            <option value="">未割当</option>
                            {availableDrivers.map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 希望休 */}
        <div className="mt-6 bg-white rounded border border-slate-200 p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-3">今週の希望休</h3>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {drivers.map((driver) => {
              const driverReqs = getDriverRequests(driver.id);
              if (driverReqs.length === 0) return null;
              return (
                <div key={driver.id} className="flex items-center gap-2 text-sm">
                  <span className="text-slate-700">{driver.name}:</span>
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
              <p className="text-sm text-slate-400">今週の希望休はありません</p>
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
