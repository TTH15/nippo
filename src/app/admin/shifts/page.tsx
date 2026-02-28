"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";

type Course = { id: string; name: string; color: string; sort_order: number; max_drivers?: number | null };
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
  slot: number;
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
  const [canWrite, setCanWrite] = useState(false);
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
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);

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
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    load();
  }, [load]);

  const handleYearMonthChange = (value: { year: number; month: number }) => {
    if (hasChanges && canWrite) {
      setConfirmState({
        message: "変更が保存されていません。破棄しますか？",
        onConfirm: () => {
          setLocalShifts(new Map());
          setHasChanges(false);
          setYearMonth(value);
        },
      });
      return;
    }
    setYearMonth(value);
  };

  const switchPeriod = (p: Period) => {
    if (hasChanges && canWrite) {
      setConfirmState({
        message: "変更が保存されていません。破棄しますか？",
        onConfirm: () => {
          setLocalShifts(new Map());
          setHasChanges(false);
          setPeriod(p);
        },
      });
      return;
    }
    setPeriod(p);
  };

  const generateDraft = async () => {
    if (!canWrite) return;
    if (displayDates.length === 0) return;
    setConfirmState({
      message:
        "この期間のシフトを希望休・配送可能ルートに基づいて自動で叩き台生成します。既存の割り当ては上書きされます。実行しますか？",
      onConfirm: async () => {
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
          setErrorState({
            title: "叩き台を生成しました",
            message: `希望休と担当可能ルートに基づいて、シフトの叩き台を自動生成しました。\n\n` +
              `この期間のシフト ${res.total} 件のうち、${res.applied} 件を自動割り当てしています。内容を確認し、必要に応じて手動で調整してください。`,
          });
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "叩き台の生成に失敗しました",
            message:
              "サーバーでエラーが発生したため、選択中の期間のシフト叩き台を生成できませんでした。\n\n" +
              "通信状況を確認のうえ、もう一度実行してください。それでも解決しない場合は、管理者に連絡してください。",
            detail: reason || undefined,
          });
        } finally {
          setGenerating(false);
        }
      },
    });
  };

  const getCellKey = (date: string, courseId: string, slot: number) => `${date}:${courseId}:${slot}`;

  // 現在のドライバーIDを取得（ローカル変更 > サーバーデータ）
  const getCurrentDriverId = (date: string, courseId: string, slot: number): string | null => {
    const key = getCellKey(date, courseId, slot);
    if (localShifts.has(key)) {
      return localShifts.get(key) ?? null;
    }
    const shift = shifts.find((s) => s.shift_date === date && s.course_id === courseId && s.slot === slot);
    return shift?.driver_id ?? null;
  };

  // その日に既に割り当てられているドライバーIDを取得
  const getAssignedDriversOnDate = (date: string, excludeCourseId?: string, excludeSlot?: number): Set<string> => {
    const assigned = new Set<string>();

    // サーバーのシフトデータ
    shifts.forEach((s) => {
      if (
        s.shift_date === date &&
        s.driver_id &&
        (s.course_id !== excludeCourseId || (excludeSlot != null && s.slot !== excludeSlot))
      ) {
        assigned.add(s.driver_id);
      }
    });

    // ローカルの変更を反映
    localShifts.forEach((driverId, key) => {
      const [keyDate, keyCourseId, keySlot] = key.split(":");
      if (
        keyDate === date &&
        (keyCourseId !== excludeCourseId || (excludeSlot != null && Number(keySlot) !== excludeSlot)) &&
        driverId
      ) {
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
  const getAvailableDrivers = (date: string, courseId: string, slot: number) => {
    const assignedOnDate = getAssignedDriversOnDate(date, courseId, slot);
    const currentDriverId = getCurrentDriverId(date, courseId, slot);

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
  const setLocalDriver = (date: string, courseId: string, slot: number, driverId: string | null) => {
    if (!canWrite) return;
    const key = getCellKey(date, courseId, slot);
    setLocalShifts((prev) => {
      const next = new Map(prev);
      next.set(key, driverId);
      return next;
    });
    setHasChanges(true);
  };

  // 一括保存
  const saveAll = async () => {
    if (!canWrite) return;
    if (localShifts.size === 0) return;
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];
      localShifts.forEach((driverId, key) => {
        const [date, courseId, slot] = key.split(":");
        promises.push(
          apiFetch("/api/admin/shifts", {
            method: "POST",
            body: JSON.stringify({ shiftDate: date, courseId, slot: Number(slot) || 1, driverId }),
          })
        );
      });
      await Promise.all(promises);
      await load();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "シフトの保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、編集したシフトを保存できませんでした。\n\n" +
          "一度ページを再読み込みして最新の状態を確認し、再度編集・保存をお試しください。\n" +
          "同じエラーが続く場合は、管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (!canWrite) return;
    setConfirmState({
      message: "変更を破棄しますか？",
      onConfirm: () => {
        setLocalShifts(new Map());
        setHasChanges(false);
      },
    });
  };

  const getDriverRequests = (driverId: string) => {
    return requests.filter((r) => r.driver_id === driverId);
  };

  /** その日に休みの人（その日いずれのコースにも割り当てられていない人）の名前リスト */
  const getOffDriverNamesOnDate = (date: string): string[] => {
    const assignedOnDate = new Set<string>();
    courses.forEach((course) => {
      const maxSlots = Math.max(1, course.max_drivers ?? 1);
      for (let slot = 1; slot <= maxSlots; slot++) {
        const driverId = getCurrentDriverId(date, course.id, slot);
        if (driverId) assignedOnDate.add(driverId);
      }
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
                className={`px-4 py-2 text-sm font-medium transition-colors ${period === "first"
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
                  }`}
              >
                前半（1〜15日）
              </button>
              <button
                type="button"
                onClick={() => switchPeriod("second")}
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-slate-200 ${period === "second"
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
                  }`}
              >
                後半（16日〜）
              </button>
            </div>
            <MonthYearPicker
              value={yearMonth}
              onChange={handleYearMonthChange}
              placeholder="年月を選択"
            />
            <button
              type="button"
              onClick={generateDraft}
              disabled={!canWrite || loading || generating || displayDates.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? "生成中..." : "叩き台を生成"}
            </button>
          </div>
        </div>

        {/* 保存バー */}
        {hasChanges && canWrite && (
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
                <tr className="border-b border-slate-100 bg-slate-50">
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
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1 px-2 sticky left-0 bg-white z-10">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    {[...Array(14)].map((_, j) => (
                      <td key={j} className="py-1.5 px-1">
                        <Skeleton className="h-8 w-full max-w-[3rem] mx-auto" />
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
                <tr className="border-b border-slate-100 bg-slate-50">
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
                        className={`py-2 px-1 text-center font-medium min-w-[4rem] ${isWeekend ? "text-red-600 bg-red-50" : "text-slate-600"
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
                  <tr key={course.id} className="border-b border-slate-50 last:border-b-0">
                    <td
                      className="py-1 px-2 font-medium text-slate-800 sticky left-0 bg-white z-10 border-l-4"
                      style={{ borderLeftColor: course.color }}
                    >
                      {course.name}
                    </td>
                    {displayDates.map((date) => {
                      const d = new Date(date);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const maxSlots = Math.max(1, course.max_drivers ?? 1);

                      return (
                        <td
                          key={date}
                          className={`py-1.5 px-1 align-top ${isWeekend ? "bg-red-50/30" : ""}`}
                        >
                          <div className="flex flex-col gap-1">
                            {Array.from({ length: maxSlots }).map((_, idx) => {
                              const slot = idx + 1;
                              const key = getCellKey(date, course.id, slot);
                              const currentDriverId = getCurrentDriverId(date, course.id, slot);
                              const isModified = localShifts.has(key);
                              const availableDrivers = getAvailableDrivers(date, course.id, slot);
                              const hasNoOptions = !currentDriverId && availableDrivers.length === 0;

                              return (
                                <select
                                  key={slot}
                                  value={currentDriverId ?? ""}
                                  onChange={(e) =>
                                    setLocalDriver(date, course.id, slot, e.target.value || null)
                                  }
                                  disabled={!canWrite}
                                  className={`w-full min-w-0 min-h-[2rem] text-xs py-1.5 px-2 rounded-md border transition-colors cursor-pointer text-center
                                    appearance-none focus:outline-none focus:ring-2 focus:ring-slate-300/60 focus:ring-offset-0
                                    disabled:cursor-not-allowed
                                    [&:not([value=\"\"])]:font-medium
                                    ${hasNoOptions
                                      ? "border-red-400 bg-red-50 text-red-700"
                                      : isModified
                                        ? "border-amber-400 bg-amber-50 text-slate-800 enabled:hover:bg-amber-100/70"
                                        : currentDriverId
                                          ? "border-slate-300 bg-slate-50 text-slate-800 enabled:hover:bg-slate-100"
                                          : "border-slate-200 bg-white text-slate-500 enabled:hover:border-slate-300 enabled:hover:bg-slate-50"
                                    }
                                  `}
                                  style={{ backgroundImage: "none" }}
                                >
                                  <option value="" className="text-slate-300">—</option>
                                  {availableDrivers.map((driver) => (
                                    <option key={driver.id} value={driver.id}>
                                      {getDisplayName(driver)}
                                    </option>
                                  ))}
                                </select>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* 休み：日付ごとにその日休みの人を表示 */}
                <tr className="border-t border-slate-100 bg-slate-50">
                  <td className="py-1 px-2 font-medium text-slate-700 sticky left-0 bg-slate-50 z-10">
                    休み
                  </td>
                  {displayDates.map((date) => {
                    const names = getOffDriverNamesOnDate(date);
                    return (
                      <td
                        key={date}
                        className="py-1.5 px-1 text-xs text-slate-600 align-top min-w-[4rem]"
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
      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => { })}
        onClose={() => setConfirmState(null)}
        confirmLabel="OK"
      />
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
    </AdminLayout>
  );
}
