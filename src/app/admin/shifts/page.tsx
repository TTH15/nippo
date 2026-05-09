"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
  driver_identities?: { driver_courses: { course_id: string }[] }[];
  driver_courses?: { course_id: string }[];
};

function getDriverCourseIds(d: Driver): string[] {
  const ids = new Set<string>();
  if (d.driver_identities?.length) {
    for (const idn of d.driver_identities) {
      for (const dc of idn.driver_courses ?? []) {
        ids.add(dc.course_id);
      }
    }
  }
  for (const dc of d.driver_courses ?? []) {
    ids.add(dc.course_id);
  }
  return Array.from(ids);
}
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

function stringToHue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 360;
  }
  return hash;
}

function driverChipColor(input: string): { bg: string; text: string } {
  const hue = stringToHue(input);
  return {
    bg: `hsl(${hue} 80% 92%)`,
    text: `hsl(${hue} 55% 28%)`,
  };
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
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "pdf">("png");
  const exportRef = useRef<HTMLDivElement | null>(null);

  const applyLocalChangesToShifts = useCallback(
    (base: Shift[], changes: Map<string, string | null>) => {
      const next = [...base];
      changes.forEach((driverId, key) => {
        const [shiftDate, courseId, slotStr] = key.split(":");
        const slot = Number(slotStr) || 1;
        const idx = next.findIndex(
          (s) => s.shift_date === shiftDate && s.course_id === courseId && s.slot === slot,
        );
        const assignedDriver = driverId
          ? (() => {
              const d = drivers.find((x) => x.id === driverId);
              return d ? { id: d.id, name: d.name, display_name: d.display_name } : null;
            })()
          : null;
        if (idx >= 0) {
          next[idx] = { ...next[idx], driver_id: driverId ?? null, drivers: assignedDriver };
        } else {
          next.push({
            id: `local:${shiftDate}:${courseId}:${slot}`,
            shift_date: shiftDate,
            course_id: courseId,
            slot,
            driver_id: driverId ?? null,
            drivers: assignedDriver,
          });
        }
      });
      return next;
    },
    [drivers],
  );

  const displayDates = useMemo(
    () =>
      period === "first"
        ? getFirstHalfDates(yearMonth.year, yearMonth.month)
        : getSecondHalfDates(yearMonth.year, yearMonth.month),
    [yearMonth.year, yearMonth.month, period],
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
            },
          );
          await load();
          setErrorState({
            title: "叩き台を生成しました",
            message:
              `希望休と担当可能ルートに基づいて、シフトの叩き台を自動生成しました。\n\n` +
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

  const getCurrentDriverId = (date: string, courseId: string, slot: number): string | null => {
    const key = getCellKey(date, courseId, slot);
    if (localShifts.has(key)) {
      return localShifts.get(key) ?? null;
    }
    const shift = shifts.find((s) => s.shift_date === date && s.course_id === courseId && s.slot === slot);
    return shift?.driver_id ?? null;
  };

  const isDriverOffDay = (driverId: string, date: string) => {
    return requests.some((r) => r.driver_id === driverId && r.request_date === date);
  };

  /** バッチ更新用: Map を重ねて効いている driverId を返す */
  const getEffectiveIdFromMap = (
    localMap: Map<string, string | null>,
    date: string,
    courseId: string,
    slot: number,
  ): string | null => {
    const key = getCellKey(date, courseId, slot);
    if (localMap.has(key)) return localMap.get(key) ?? null;
    const shift = shifts.find((s) => s.shift_date === date && s.course_id === courseId && s.slot === slot);
    return shift?.driver_id ?? null;
  };

  const findDriverPlacementOnDate = (
    localMap: Map<string, string | null>,
    date: string,
    driverId: string,
  ): { courseId: string; slot: number } | null => {
    for (const c of courses) {
      const maxSlots = Math.max(1, c.max_drivers ?? 1);
      for (let s = 1; s <= maxSlots; s++) {
        if (getEffectiveIdFromMap(localMap, date, c.id, s) === driverId) {
          return { courseId: c.id, slot: s };
        }
      }
    }
    return null;
  };

  const hasFreeSlotOnCourse = (date: string, courseId: string, localMap: Map<string, string | null>): boolean => {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return false;
    const maxSlots = Math.max(1, course.max_drivers ?? 1);
    for (let s = 1; s <= maxSlots; s++) {
      if (!getEffectiveIdFromMap(localMap, date, courseId, s)) return true;
    }
    return false;
  };

  /** その日の当該ドライバーの行をいったん空けたあと、指定コースに空きがあるか */
  const canAssignDriverToCourseAfterClearing = (
    date: string,
    driverId: string,
    courseId: string,
    baseMap: Map<string, string | null>,
  ): boolean => {
    const cleared = new Map(baseMap);
    for (const c of courses) {
      const maxSlots = Math.max(1, c.max_drivers ?? 1);
      for (let s = 1; s <= maxSlots; s++) {
        if (getEffectiveIdFromMap(cleared, date, c.id, s) === driverId) {
          cleared.set(getCellKey(date, c.id, s), null);
        }
      }
    }
    return hasFreeSlotOnCourse(date, courseId, cleared);
  };

  const handleCellClick = (date: string, driverId: string, courseId: string) => {
    if (!canWrite) return;
    const driver = drivers.find((d) => d.id === driverId);
    if (!driver) return;

    const allowedCourses = getDriverCourseIds(driver);
    if (!allowedCourses.includes(courseId)) return;

    if (isDriverOffDay(driverId, date)) {
      setErrorState({
        title: "割り当てできません",
        message: "この日は希望休が登録されているため、このドライバーを割り当てられません。",
      });
      return;
    }

    const placementBefore = findDriverPlacementOnDate(localShifts, date, driverId);
    if (placementBefore?.courseId === courseId) {
      setLocalShifts((prev) => {
        const next = new Map(prev);
        next.set(getCellKey(date, courseId, placementBefore.slot), null);
        return next;
      });
      setHasChanges(true);
      return;
    }

    if (!canAssignDriverToCourseAfterClearing(date, driverId, courseId, localShifts)) {
      setErrorState({
        title: "割り当てできません",
        message: "このコースの定員に達しているため、割り当てできません。",
      });
      return;
    }

    setLocalShifts((prev) => {
      const next = new Map(prev);

      for (const c of courses) {
        const maxSlots = Math.max(1, c.max_drivers ?? 1);
        for (let s = 1; s <= maxSlots; s++) {
          if (getEffectiveIdFromMap(next, date, c.id, s) === driverId) {
            next.set(getCellKey(date, c.id, s), null);
          }
        }
      }

      const courseObj = courses.find((c) => c.id === courseId)!;
      const maxSlots = Math.max(1, courseObj.max_drivers ?? 1);
      let chosenSlot: number | null = null;
      for (let s = 1; s <= maxSlots; s++) {
        if (!getEffectiveIdFromMap(next, date, courseId, s)) {
          chosenSlot = s;
          break;
        }
      }
      if (chosenSlot === null) return prev;

      next.set(getCellKey(date, courseId, chosenSlot), driverId);
      return next;
    });
    setHasChanges(true);
  };

  const saveAll = async () => {
    if (!canWrite) return;
    if (localShifts.size === 0) return;
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];
      localShifts.forEach((driverId, key) => {
        const [dDate, cId, slot] = key.split(":");
        promises.push(
          apiFetch("/api/admin/shifts", {
            method: "POST",
            body: JSON.stringify({
              shiftDate: dDate,
              courseId: cId,
              slot: Number(slot) || 1,
              driverId,
            }),
          }),
        );
      });
      await Promise.all(promises);
      setShifts((prev) => applyLocalChangesToShifts(prev, localShifts));
      setLocalShifts(new Map());
      setHasChanges(false);
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

  const isDriverAssignedToCourse = (date: string, driverId: string, courseId: string): boolean => {
    const maxSlots = Math.max(1, courses.find((c) => c.id === courseId)?.max_drivers ?? 1);
    for (let s = 1; s <= maxSlots; s++) {
      if (getCurrentDriverId(date, courseId, s) === driverId) return true;
    }
    return false;
  };

  const handleExport = async () => {
    if (exporting) return;
    const root = exportRef.current;
    if (!root) return;
    try {
      setExporting(true);
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(root, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const targetWidth = 2400;
      const targetHeight = 1400;
      const fitted = document.createElement("canvas");
      fitted.width = targetWidth;
      fitted.height = targetHeight;
      const ctx = fitted.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      const scale = Math.min(targetWidth / canvas.width, targetHeight / canvas.height);
      const renderWidth = canvas.width * scale;
      const renderHeight = canvas.height * scale;
      const offsetX = (targetWidth - renderWidth) / 2;
      const offsetY = (targetHeight - renderHeight) / 2;
      ctx.drawImage(canvas, offsetX, offsetY, renderWidth, renderHeight);
      const dataUrl = fitted.toDataURL("image/png");

      if (exportFormat === "png") {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `shifts_${yearMonth.year}-${String(yearMonth.month).padStart(2, "0")}_${period}.png`;
        a.click();
      } else {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF("landscape", "pt", "a4");
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const pdfScale = Math.min(pageWidth / targetWidth, pageHeight / targetHeight);
        const pdfWidth = targetWidth * pdfScale;
        const pdfHeight = targetHeight * pdfScale;
        const pdfX = (pageWidth - pdfWidth) / 2;
        const pdfY = (pageHeight - pdfHeight) / 2;
        pdf.addImage(dataUrl, "PNG", pdfX, pdfY, pdfWidth, pdfHeight);
        pdf.save(`shifts_${yearMonth.year}-${String(yearMonth.month).padStart(2, "0")}_${period}.pdf`);
      }
    } catch (e) {
      console.error(e);
      setErrorState({
        title: "エクスポートに失敗しました",
        message: "シフト画面のエクスポート中にエラーが発生しました。もう一度お試しください。",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-full">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">シフト管理</h1>
            <p className="text-xs text-slate-500 mt-1">
              日付ごとにドライバー（行）× コース（列）。担当可能なコースのみクリックして割り当てられます。
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => switchPeriod("first")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  period === "first"
                    ? "bg-slate-800 text-white"
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
              className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? "生成中..." : "叩き台を生成"}
            </button>
            <div className="flex items-center gap-2">
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value === "pdf" ? "pdf" : "png")}
                className="h-9 px-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="png">画像（PNG）</option>
                <option value="pdf">PDF</option>
              </select>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || loading}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting ? "エクスポート中..." : "エクスポート"}
              </button>
            </div>
          </div>
        </div>

        {hasChanges && canWrite && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded flex items-center justify-between">
            <span className="text-sm font-medium text-amber-800">{localShifts.size}件の未保存の変更</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={discardChanges}
                className="px-3 py-1 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                破棄
              </button>
              <button
                type="button"
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
          <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="bg-white rounded border border-slate-200 overflow-x-auto p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {displayDates.map((date) => {
              const d = new Date(date);
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              const offNames = getOffDriverNamesOnDate(date);
              return (
                <div
                  key={date}
                  className={`rounded-lg border border-slate-200 bg-white overflow-hidden ${
                    isWeekend ? "ring-1 ring-red-100" : ""
                  }`}
                >
                  <div
                    className={`px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap ${
                      isWeekend ? "bg-red-50/80" : "bg-slate-50"
                    }`}
                  >
                    <span
                      className={`text-sm font-semibold ${isWeekend ? "text-red-700" : "text-slate-800"}`}
                    >
                      {formatDate(date)}
                    </span>
                    {offNames.length > 0 && (
                      <span className="text-xs text-slate-500">
                        未割当（休み扱い）:{" "}
                        <span className="text-slate-700">{offNames.join("・")}</span>
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead>
                        <tr className="border-b border-slate-100 bg-white">
                          <th className="sticky left-0 z-20 bg-white py-2 px-3 text-left font-medium text-slate-600 min-w-[9rem] shadow-[2px_0_0_0_rgb(241_245_249)]">
                            ドライバー
                          </th>
                          {courses.map((course) => (
                            <th
                              key={`${date}-${course.id}`}
                              className="py-2 px-1.5 text-center font-medium text-slate-700 min-w-[5.5rem] border-l-4 bg-slate-50/90"
                              style={{ borderLeftColor: course.color }}
                            >
                              <span className="line-clamp-2">{course.name}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {drivers.map((driver) => {
                          const allowed = new Set(getDriverCourseIds(driver));
                          const off = isDriverOffDay(driver.id, date);
                          return (
                            <tr key={`${date}-${driver.id}`} className="border-b border-slate-50 last:border-b-0">
                              <td className="sticky left-0 z-10 bg-white py-2 px-3 align-middle shadow-[2px_0_0_0_rgb(241_245_249)]">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium text-slate-800 leading-tight">
                                    {getDisplayName(driver)}
                                  </span>
                                  {off && (
                                    <span className="text-[10px] font-medium text-amber-700">希望休</span>
                                  )}
                                </div>
                              </td>
                              {courses.map((course) => {
                                const eligible = allowed.has(course.id);
                                const assigned = isDriverAssignedToCourse(date, driver.id, course.id);
                                const keyPrefix = `${date}-${driver.id}-${course.id}`;
                                const maxSlots = Math.max(1, course.max_drivers ?? 1);
                                const slotKeys = Array.from({ length: maxSlots }, (_, i) =>
                                  getCellKey(date, course.id, i + 1),
                                );
                                const isModified = slotKeys.some((k) => {
                                  if (!localShifts.has(k)) return false;
                                  const slot = Number(k.split(":").pop()) || 1;
                                  return getCurrentDriverId(date, course.id, slot) === driver.id;
                                });

                                let filled = 0;
                                const otherNames: string[] = [];
                                for (let s = 1; s <= maxSlots; s++) {
                                  const oid = getCurrentDriverId(date, course.id, s);
                                  if (!oid) continue;
                                  filled++;
                                  if (oid !== driver.id) {
                                    const od = drivers.find((x) => x.id === oid);
                                    if (od) otherNames.push(getDisplayName(od));
                                  }
                                }
                                const hasFreeSlot = filled < maxSlots;
                                const courseFull = !assigned && eligible && !hasFreeSlot;

                                const canTapAssign =
                                  canWrite && eligible && !off && !courseFull;

                                return (
                                  <td
                                    key={keyPrefix}
                                    className={`py-1.5 px-1 align-middle text-center border-l border-slate-100 ${
                                      !eligible ? "bg-slate-50/80" : isWeekend ? "bg-red-50/20" : ""
                                    }`}
                                  >
                                    {!eligible ? (
                                      <span className="text-slate-300 text-xs">—</span>
                                    ) : assigned ? (
                                      <button
                                        type="button"
                                        title={canWrite ? "クリックでこのコースの割当を解除" : undefined}
                                        onClick={() => handleCellClick(date, driver.id, course.id)}
                                        disabled={!canWrite || off}
                                        className={`w-full min-h-[2rem] rounded-md border text-xs font-semibold transition-colors ${
                                          isModified
                                            ? "border-amber-400 bg-amber-50 text-slate-900"
                                            : "border-emerald-300 bg-emerald-50 text-emerald-900"
                                        } ${!canWrite || off ? "opacity-60 cursor-default" : "hover:bg-emerald-100"}`}
                                      >
                                        担当
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        title={
                                          courseFull
                                            ? `定員（${otherNames.slice(0, 3).join("・")}${otherNames.length > 3 ? "…" : ""}）`
                                            : canWrite
                                              ? "クリックでこのコースに割当"
                                              : undefined
                                        }
                                        onClick={() => handleCellClick(date, driver.id, course.id)}
                                        disabled={!canTapAssign}
                                        className={`w-full min-h-[2rem] rounded-md border text-xs transition-colors ${
                                          courseFull
                                            ? "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                                            : isModified
                                              ? "border-amber-400 bg-amber-50 text-slate-700"
                                              : "border-dashed border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:bg-slate-50"
                                        } ${!canTapAssign && !courseFull ? "opacity-60 cursor-not-allowed" : ""}`}
                                      >
                                        {courseFull ? (
                                          <span className="line-clamp-3 leading-tight">
                                            満員
                                            {otherNames.length > 0 && (
                                              <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
                                                {otherNames[0]}
                                                {otherNames.length > 1
                                                  ? ` 他${otherNames.length - 1}`
                                                  : ""}
                                              </span>
                                            )}
                                          </span>
                                        ) : (
                                          "タップ"
                                        )}
                                      </button>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            <div className="bg-white rounded border border-slate-200 p-4">
              <h3 className="text-sm font-medium text-slate-700 mb-3">この期間の希望休（一覧）</h3>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {drivers.map((driver) => {
                  const driverReqs = getDriverRequests(driver.id);
                  if (driverReqs.length === 0) return null;
                  return (
                    <div key={driver.id} className="flex items-center gap-2 text-sm">
                      <span className="text-slate-700">{getDisplayName(driver)}:</span>
                      <div className="flex gap-1 flex-wrap">
                        {driverReqs.map((r) => (
                          <span
                            key={r.id}
                            className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs"
                          >
                            <span className="mr-1">{formatDate(r.request_date)}</span>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setConfirmState({
                                    message: `${getDisplayName(driver)} の希望休（${formatDate(r.request_date)}）を解除しますか？`,
                                    onConfirm: async () => {
                                      try {
                                        await apiFetch(`/api/admin/shifts/requests/${r.id}`, {
                                          method: "DELETE",
                                        });
                                        setRequests((prev) => prev.filter((x) => x.id !== r.id));
                                      } catch (e) {
                                        console.error(e);
                                        setErrorState({
                                          title: "希望休の解除に失敗しました",
                                          message:
                                            "サーバーでエラーが発生したため、希望休を解除できませんでした。もう一度お試しください。",
                                        });
                                      }
                                    },
                                  });
                                }}
                                className="ml-1 text-[11px] text-slate-400 hover:text-slate-800"
                                title="希望休を解除"
                              >
                                ×
                              </button>
                            )}
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

            <div className="flex flex-wrap gap-6 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-6 rounded border border-slate-200 bg-slate-50" />
                <span>担当不可コース（マスタ未割当）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-6 rounded border border-dashed border-slate-200 bg-white" />
                <span>未割当（タップで割当）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-6 rounded border border-emerald-300 bg-emerald-50" />
                <span>割当済</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-6 rounded border border-amber-400 bg-amber-50" />
                <span>未保存の変更</span>
              </div>
            </div>
          </div>
        )}

        <div className="fixed -left-[99999px] top-0 pointer-events-none">
          <div
            ref={exportRef}
            style={{
              width: "2200px",
              background: "#ffffff",
              color: "#111827",
              padding: "24px",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            }}
          >
            <h2 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 16px" }}>
              シフト表（{yearMonth.year}年{yearMonth.month}月 {period === "first" ? "前半" : "後半"}）
            </h2>
            {displayDates.map((date) => (
              <div key={`export-${date}`} style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "8px", color: "#374151" }}>
                  {formatDate(date)}
                </div>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "separate",
                    borderSpacing: "0 2px",
                    fontSize: "12px",
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          width: "160px",
                          textAlign: "left",
                          padding: "4px 8px",
                          color: "#6b7280",
                          background: "#f9fafb",
                        }}
                      >
                        ドライバー
                      </th>
                      {courses.map((course) => (
                        <th
                          key={`ex-h-${date}-${course.id}`}
                          style={{
                            textAlign: "center",
                            padding: "4px 6px",
                            borderLeft: `4px solid ${course.color}`,
                            background: "#f9fafb",
                            color: "#374151",
                            maxWidth: "100px",
                          }}
                        >
                          {course.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((driver) => (
                      <tr key={`ex-r-${date}-${driver.id}`}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "#111827" }}>
                          {getDisplayName(driver)}
                        </td>
                        {courses.map((course) => {
                          const assigned = isDriverAssignedToCourse(date, driver.id, course.id);
                          const eligible = getDriverCourseIds(driver).includes(course.id);
                          if (!eligible) {
                            return (
                              <td
                                key={`ex-c-${date}-${driver.id}-${course.id}`}
                                style={{ padding: "4px", background: "#f9fafb" }}
                              >
                                <div style={{ color: "#d1d5db", textAlign: "center" }}>—</div>
                              </td>
                            );
                          }
                          if (!assigned) {
                            return (
                              <td key={`ex-c-${date}-${driver.id}-${course.id}`} style={{ padding: "4px" }}>
                                <div style={{ color: "#d1d5db", textAlign: "center", fontSize: "11px" }}>・</div>
                              </td>
                            );
                          }
                          const name = getDisplayName(driver);
                          const color = driverChipColor(name);
                          return (
                            <td key={`ex-c-${date}-${driver.id}-${course.id}`} style={{ padding: "4px" }}>
                              <div
                                style={{
                                  background: color.bg,
                                  color: color.text,
                                  borderRadius: "6px",
                                  padding: "3px 6px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  textAlign: "center",
                                }}
                              >
                                {name}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
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
