"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { isJapanPublicHolidayYmd } from "@/lib/japanHolidays";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canEditShifts } from "@/lib/authz";
import {
  formatPlateNumeric,
  VehiclePlate,
  type VehiclePlateData,
} from "@/lib/components/VehiclePlate";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/ui/popover";
import { cn } from "@/lib/ui/utils";
import { ChevronDown } from "lucide-react";

type Course = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  max_drivers?: number | null;
  /** コース編集画面の「略記」。未設定時はコース名を表示 */
  summary_title?: string | null;
};

/** シフト・エクスポートで見せる文言（略記優先・なければ正式名） */
function courseShiftLabel(course: Course): string {
  const t = course.summary_title?.trim();
  return t ? t : course.name;
}

/** 同日×同ドライバーの車両上書き用（ISO日付 と UUID はどちらもハイフンを含むため区切りに | を使う） */
function driverDayVehicleKey(date: string, driverId: string): string {
  return `${date}|${driverId}`;
}

/** 一覧・セル用のコンパクトなナンバー表記（プレート縮約） */
function formatPlateOneLine(v: VehiclePlateData): string {
  const parts = [
    v.number_prefix ?? "",
    v.number_class ?? "",
    v.number_hiragana ?? "",
    v.number_numeric ? formatPlateNumeric(v.number_numeric) : "",
  ].filter((x) => String(x).trim() !== "");
  return parts.join(" ").trim() || "—";
}

function courseAbbrevTooltip(course: Course): string {
  const abbr = courseShiftLabel(course);
  return abbr !== course.name ? `${abbr}（${course.name}）` : abbr;
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 6 || !/^[0-9a-fA-F]+$/.test(raw)) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** コース色：背景＋内側フレームで色をはっきり示す */
function courseCellSurface(hex: string): Pick<CSSProperties, "background" | "boxShadow"> {
  return {
    background: hexToRgba(hex, 0.44),
    boxShadow: `inset 0 0 0 2px ${hexToRgba(hex, 0.72)}`,
  };
}

/**
 * エクスポート（html2canvas）用のコース色面。
 * html2canvas は inset box-shadow を正しく描けず縞・重なり模様になるため、
 * box-shadow を使わず通常の border で枠を表現する。
 */
function courseCellSurfaceExport(hex: string): CSSProperties {
  return {
    background: hexToRgba(hex, 0.44),
    border: `2px solid ${hexToRgba(hex, 0.72)}`,
  };
}

/**
 * エクスポートのセル内寸法（px）。
 * 車両割り当ての有無に関わらず全セルの高さを揃えるため、
 * コース欄＋車両欄の高さを固定し、空セル・希望休も同じ高さにする。
 * html2canvas は flex の中央寄せを正しく描けないため、
 * 縦中央は lineHeight（行高＝ボックス高）で表現する。
 */
const EX_COURSE_H = 36;
const EX_PLATE_H = 20;
const EX_CELL_GAP = 4;
const EX_CELL_CONTENT_H = EX_COURSE_H + EX_CELL_GAP + EX_PLATE_H;

/** 祝日・日曜＝赤系、土曜＝青系（祝日は土曜より優先） */
function shiftDayTone(dateStr: string): { header: string; body: string } {
  if (isJapanPublicHolidayYmd(dateStr)) {
    return {
      header: "text-red-700 bg-red-50/90",
      body: "bg-red-50/[0.14]",
    };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return { header: "text-slate-600", body: "" };
  const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  const w = local.getDay();
  if (w === 0) {
    return {
      header: "text-red-700 bg-red-50/90",
      body: "bg-red-50/[0.14]",
    };
  }
  if (w === 6) {
    return {
      header: "text-blue-800 bg-blue-50/90",
      body: "bg-blue-50/30",
    };
  }
  return { header: "text-slate-600", body: "" };
}

function exportDayChrome(dateStr: string): { headBg: string; headColor: string; cellBg?: string } {
  if (isJapanPublicHolidayYmd(dateStr)) {
    return {
      headBg: "#fef2f2",
      headColor: "#b91c1c",
      cellBg: "rgba(254, 242, 242, 0.35)",
    };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return { headBg: "#f9fafb", headColor: "#6b7280" };
  const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  const w = local.getDay();
  if (w === 0) {
    return { headBg: "#fef2f2", headColor: "#b91c1c", cellBg: "rgba(254, 242, 242, 0.35)" };
  }
  if (w === 6) {
    return { headBg: "#eff6ff", headColor: "#1e40af", cellBg: "rgba(239, 246, 255, 0.45)" };
  }
  return { headBg: "#f9fafb", headColor: "#6b7280" };
}

function ShiftVehiclePlatePicker({
  valueId,
  displayVehicle,
  linkedPlates,
  otherPlates,
  takenBy,
  onChange,
  disabled,
  dirty,
  title,
}: {
  valueId: string | null;
  displayVehicle: VehiclePlateData | null;
  linkedPlates: VehiclePlateData[];
  otherPlates: VehiclePlateData[];
  /** その日すでに他ドライバーが使用中の車両 id → 使用者名 */
  takenBy?: Map<string, string>;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  dirty?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  const row = (v: VehiclePlateData) => {
    const selected = valueId === v.id;
    const takenByName = !selected ? takenBy?.get(v.id) : undefined;
    const isTaken = Boolean(takenByName);
    return (
      <button
        key={v.id}
        type="button"
        disabled={isTaken}
        title={isTaken ? `${takenByName} さんが使用中` : undefined}
        className={cn(
          "w-full rounded-md p-0.5 flex flex-col items-center gap-0.5 transition-colors",
          isTaken
            ? "opacity-45 cursor-not-allowed"
            : selected
              ? "bg-slate-100/95 ring-1 ring-slate-400/40"
              : "hover:bg-slate-50/90",
        )}
        onClick={() => {
          if (isTaken) return;
          onChange(v.id);
          setOpen(false);
        }}
      >
        <VehiclePlate vehicle={v} compact className="!max-w-[12rem] w-full min-w-0 pointer-events-none" />
        {isTaken ? (
          <span className="text-[9px] font-medium text-rose-500 leading-none pb-0.5">
            {takenByName} さん使用中
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={title}
          className={cn(
            "w-full flex items-center gap-0.5 rounded-lg px-0.5 py-0.5 min-h-0 border transition-colors text-left",
            disabled && "opacity-50 cursor-not-allowed",
            dirty ? "border-amber-300/80 bg-amber-50/50" : "border-slate-200/90 bg-white hover:border-slate-300/90",
          )}
        >
          <div className="flex-1 min-w-0 flex justify-center [&_.plate-font-hiragana]:tracking-tight">
            {valueId && displayVehicle ? (
              <VehiclePlate vehicle={displayVehicle} compact className="!max-w-none w-full min-w-0 pointer-events-none" />
            ) : (
              <span className="text-[10px] text-slate-400 font-medium py-0.5">車両なし</span>
            )}
          </div>
          <ChevronDown className="h-3 w-3 text-slate-400 shrink-0 self-center mr-0.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-auto min-w-[12rem] max-w-[min(20rem,calc(100vw-1.5rem))] p-0 max-h-[min(22rem,70vh)] overflow-y-auto border-slate-200/90 shadow-lg"
      >
        <div className="p-1.5 pb-0">
          <button
            type="button"
            className={cn(
              "w-full text-left text-[11px] py-2 px-2 rounded-md transition-colors",
              !valueId ? "bg-slate-100/90 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50",
            )}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            車両なし
          </button>
        </div>
        {linkedPlates.length > 0 && (
          <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            <p className="px-1 text-[10px] font-medium text-slate-500">紐づけ車両</p>
            {linkedPlates.map((v) => row(v))}
          </div>
        )}
        {otherPlates.length > 0 && (
          <div className="border-t border-slate-200/80 bg-slate-50/40 px-1.5 py-1.5">
            <p className="px-1 pb-1.5 text-[10px] font-semibold text-slate-600">他の車両を追加</p>
            <p className="px-1 pb-1.5 text-[9px] leading-snug text-slate-500">その他の車両（全社マスタ・未紐づけ含む）</p>
            <div className="flex flex-col gap-0.5">{otherPlates.map((v) => row(v))}</div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** シフト一覧の「日」列・セルの共通幅（コース名・ナンバーが省略されにくいよう少し広め） */
const SHIFT_COL_WIDTH_CLASS =
  "w-[6.5rem] min-w-[6.5rem] max-w-[6.5rem] box-border";

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
  vehicle_id?: string | null;
  /** FK vehicle_id のネスト（0〜1台） */
  vehicles?: VehiclePlateData | VehiclePlateData[] | null;
};

function normalizeShiftVehiclesEmbed(s: Shift): Shift & { vehicles?: VehiclePlateData | null } {
  const raw = s.vehicles;
  const one = Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
  return { ...s, vehicles: one };
}
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
  const [autoSaving, setAutoSaving] = useState(0);
  const [generating, setGenerating] = useState(false);

  const [localShifts, setLocalShifts] = useState<Map<string, string | null>>(new Map());
  const [localVehicleByDriverDay, setLocalVehicleByDriverDay] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [fleetVehicles, setFleetVehicles] = useState<VehiclePlateData[]>([]);
  const [vehicleLinks, setVehicleLinks] = useState<{ driver_id: string; vehicle_id: string }[]>([]);

  const fleetById = useMemo(() => {
    const m = new Map<string, VehiclePlateData>();
    for (const v of fleetVehicles) {
      m.set(v.id, v);
    }
    return m;
  }, [fleetVehicles]);

  const driversWithCourses = useMemo(
    () => drivers.filter((d) => getDriverCourseIds(d).length > 0),
    [drivers],
  );

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

  const displayDates = useMemo(
    () =>
      period === "first"
        ? getFirstHalfDates(yearMonth.year, yearMonth.month)
        : getSecondHalfDates(yearMonth.year, yearMonth.month),
    [yearMonth.year, yearMonth.month, period],
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (displayDates.length === 0) return;
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    const start = displayDates[0];
    const end = displayDates[displayDates.length - 1];
    try {
      const res = await apiFetch<{
        courses: Course[];
        drivers: Driver[];
        shifts: Shift[];
        requests: ShiftRequest[];
        vehicles?: VehiclePlateData[];
        vehicle_driver_links?: { driver_id: string; vehicle_id: string }[];
      }>(`/api/admin/shifts?start=${start}&end=${end}`);
      setCourses(res.courses);
      setDrivers(res.drivers);
      setShifts((res.shifts ?? []).map((s) => normalizeShiftVehiclesEmbed(s)));
      setRequests(res.requests);
      setFleetVehicles(Array.isArray(res.vehicles) ? res.vehicles : []);
      setVehicleLinks(res.vehicle_driver_links ?? []);
      setLocalShifts(new Map());
      setLocalVehicleByDriverDay(new Map());
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [displayDates]);

  useEffect(() => {
    setCanWrite(canEditShifts(getStoredDriver()?.role));
    load();
  }, [load]);

  // 自動保存のため未保存確認は不要。そのまま切り替える。
  const handleYearMonthChange = (value: { year: number; month: number }) => {
    setYearMonth(value);
  };

  const switchPeriod = (p: Period) => {
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

  /** その日に当該ドライバーが割り当てられている全コース（複数シフト対応） */
  const findDriverPlacementsOnDate = (
    localMap: Map<string, string | null>,
    date: string,
    driverId: string,
  ): { courseId: string; slot: number }[] => {
    const out: { courseId: string; slot: number }[] = [];
    for (const c of courses) {
      const maxSlots = Math.max(1, c.max_drivers ?? 1);
      for (let s = 1; s <= maxSlots; s++) {
        if (getEffectiveIdFromMap(localMap, date, c.id, s) === driverId) {
          out.push({ courseId: c.id, slot: s });
        }
      }
    }
    return out;
  };

  /** 車両など「1日1台」前提のロジック用の代表 placement（先頭コース） */
  const findDriverPlacementOnDate = (
    localMap: Map<string, string | null>,
    date: string,
    driverId: string,
  ): { courseId: string; slot: number } | null => {
    return findDriverPlacementsOnDate(localMap, date, driverId)[0] ?? null;
  };

  /** 親 shift 行の vehicle_id を解決（車両選択はドライバー×日単位だが保存はシフト行） */
  const getCurrentVehicleForDriverOnDate = (date: string, driverId: string): string | null => {
    const dk = driverDayVehicleKey(date, driverId);
    if (localVehicleByDriverDay.has(dk)) return localVehicleByDriverDay.get(dk) ?? null;
    const placement = findDriverPlacementOnDate(localShifts, date, driverId);
    if (!placement) return null;
    const row = shifts.find(
      (s) =>
        s.shift_date === date &&
        s.course_id === placement.courseId &&
        s.slot === placement.slot,
    );
    return row?.vehicle_id ?? null;
  };

  /** その日に車両がすでに割り当てられているドライバー（vehicle_id → driver_id[]） */
  const vehicleHoldersByDate = useMemo(() => {
    const byDate = new Map<string, Map<string, string[]>>();
    for (const date of displayDates) {
      const inner = new Map<string, string[]>();
      for (const d of driversWithCourses) {
        const placement = findDriverPlacementOnDate(localShifts, date, d.id);
        if (!placement) continue;
        const vid = getCurrentVehicleForDriverOnDate(date, d.id);
        if (!vid) continue;
        const arr = inner.get(vid);
        if (arr) arr.push(d.id);
        else inner.set(vid, [d.id]);
      }
      byDate.set(date, inner);
    }
    return byDate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayDates, driversWithCourses, localShifts, localVehicleByDriverDay, shifts]);

  /** その日その車両を使っている「他の」ドライバー名（重複割り当て検知用） */
  const getOtherVehicleHolderName = (
    date: string,
    vehicleId: string,
    selfDriverId: string,
  ): string | null => {
    const holders = vehicleHoldersByDate.get(date)?.get(vehicleId);
    if (!holders) return null;
    const otherId = holders.find((id) => id !== selfDriverId);
    if (!otherId) return null;
    const od = drivers.find((d) => d.id === otherId);
    return od ? getDisplayName(od) : "別のドライバー";
  };

  const setVehicleForDriverOnDate = (date: string, driverId: string, vehicleId: string | null) => {
    if (!canWrite) return;
    if (vehicleId) {
      const holder = getOtherVehicleHolderName(date, vehicleId, driverId);
      if (holder) {
        setErrorState({
          title: "車両を割り当てできません",
          message: `この車両は同じ日に ${holder} さんへすでに割り当てられています。1台の車両を同じ日に複数人へ割り当てることはできません。`,
        });
        return;
      }
    }
    setLocalVehicleByDriverDay((prev) => {
      const next = new Map(prev);
      next.set(driverDayVehicleKey(date, driverId), vehicleId);
      return next;
    });
    // 車両は1日1台。当該ドライバーの全コース行へ同じ車両を即時保存
    for (const p of findDriverPlacementsOnDate(localShifts, date, driverId)) {
      persistOne(date, p.courseId, p.slot, driverId, vehicleId);
    }
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

  /** 指定コースに当該ドライバーを「追加」できるか（既存割当は維持） */
  const canAddDriverToCourse = (
    date: string,
    driverId: string,
    courseId: string,
    baseMap: Map<string, string | null>,
  ): boolean => {
    // すでにそのコースに入っているなら追加不可（重複防止）
    if (findDriverPlacementsOnDate(baseMap, date, driverId).some((p) => p.courseId === courseId)) {
      return false;
    }
    return hasFreeSlotOnCourse(date, courseId, baseMap);
  };

  /** ドライバーを指定コースへ追加（他コースの割当は消さない＝複数シフト） */
  const addDriverToCourseOnDate = (date: string, driverId: string, courseId: string) => {
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

    // すでに同じコースに入っているなら何もしない
    if (findDriverPlacementsOnDate(localShifts, date, driverId).some((p) => p.courseId === courseId)) {
      return;
    }

    if (!hasFreeSlotOnCourse(date, courseId, localShifts)) {
      setErrorState({
        title: "割り当てできません",
        message: "このコースの定員に達しているため、割り当てできません。",
      });
      return;
    }

    // 空きスロットを事前に確定（保存に slot が必要なため）
    const courseObj = courses.find((c) => c.id === courseId)!;
    const maxSlots = Math.max(1, courseObj.max_drivers ?? 1);
    let chosenSlot: number | null = null;
    for (let s = 1; s <= maxSlots; s++) {
      if (!getEffectiveIdFromMap(localShifts, date, courseId, s)) {
        chosenSlot = s;
        break;
      }
    }
    if (chosenSlot === null) return;
    const slot = chosenSlot;

    setLocalShifts((prev) => {
      const next = new Map(prev);
      next.set(getCellKey(date, courseId, slot), driverId);
      return next;
    });
    // 既存の当日車両を引き継いで即時保存
    persistOne(date, courseId, slot, driverId, getCurrentVehicleForDriverOnDate(date, driverId));
  };

  /** ドライバーを指定コースから外す（他コースの割当は維持。最後の1件なら車両もクリア） */
  const removeDriverFromCourseOnDate = (date: string, driverId: string, courseId: string) => {
    if (!canWrite) return;
    const placements = findDriverPlacementsOnDate(localShifts, date, driverId);
    const wasLast = placements.length <= 1;
    // このコースで当該ドライバーが入っているスロット（保存対象）
    const clearedSlots = placements.filter((p) => p.courseId === courseId).map((p) => p.slot);
    setLocalShifts((prev) => {
      const next = new Map(prev);
      for (const slot of clearedSlots) {
        next.set(getCellKey(date, courseId, slot), null);
      }
      return next;
    });
    if (wasLast) {
      setLocalVehicleByDriverDay((prev) => {
        const next = new Map(prev);
        next.set(driverDayVehicleKey(date, driverId), null);
        return next;
      });
    }
    // 外したセルを即時保存（driverId=null）
    for (const slot of clearedSlots) persistOne(date, courseId, slot, null, null);
  };

  /**
   * 1セル分を即時バックグラウンド保存（楽観的・保存ボタン不要）。
   * 値は呼び出し側が明示指定（setState 直後で state が未反映のため）。
   * 失敗時は最新状態を再取得して巻き戻す。
   */
  const persistOne = (
    date: string,
    courseId: string,
    slot: number,
    driverId: string | null,
    vehicleId: string | null,
  ) => {
    if (!canWrite) return;
    setAutoSaving((n) => n + 1);
    apiFetch("/api/admin/shifts", {
      method: "POST",
      body: JSON.stringify({ shiftDate: date, courseId, slot, driverId, vehicleId }),
    })
      .catch((e) => {
        console.error(e);
        setErrorState({
          title: "自動保存に失敗しました",
          message:
            "変更をサーバーに保存できませんでした。最新の状態に戻します。\n通信状況を確認のうえ、もう一度お試しください。",
          detail: e instanceof Error ? e.message : undefined,
        });
        void load({ silent: true });
      })
      .finally(() => setAutoSaving((n) => Math.max(0, n - 1)));
  };

  const getDriverRequests = (driverId: string) => {
    return requests.filter((r) => r.driver_id === driverId);
  };

  /** その日に休みの人（その日いずれのコースにも割り当てられていない人）の名前リスト（コース未登録ドライバーは対象外） */
  const getOffDriverNamesOnDate = (date: string): string[] => {
    const assignedOnDate = new Set<string>();
    courses.forEach((course) => {
      const maxSlots = Math.max(1, course.max_drivers ?? 1);
      for (let slot = 1; slot <= maxSlots; slot++) {
        const driverId = getCurrentDriverId(date, course.id, slot);
        if (driverId) assignedOnDate.add(driverId);
      }
    });
    return driversWithCourses
      .filter((d) => !assignedOnDate.has(d.id))
      .map((d) => getDisplayName(d))
      .sort();
  };

  /** 「＋コース」追加用: このドライバーがまだ入っていない＆定員に空きがあるコース */
  const getAddableCoursesForDriverOnDate = (date: string, driverId: string): Course[] => {
    const driver = drivers.find((d) => d.id === driverId);
    if (!driver) return [];
    const allowed = new Set(getDriverCourseIds(driver));
    return courses
      .filter((c) => allowed.has(c.id) && canAddDriverToCourse(date, driverId, c.id, localShifts))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  };

  /** ローカル編集により、このセルが未保存になるか（コースまたは車両） */
  const isDateDriverDirty = (date: string, driverId: string): boolean => {
    for (const c of courses) {
      const maxSlots = Math.max(1, c.max_drivers ?? 1);
      for (let s = 1; s <= maxSlots; s++) {
        const k = getCellKey(date, c.id, s);
        if (!localShifts.has(k)) continue;
        const localVal = localShifts.get(k) ?? null;
        const serverVal =
          shifts.find((sh) => sh.shift_date === date && sh.course_id === c.id && sh.slot === s)?.driver_id ??
          null;
        if (localVal === serverVal) continue;
        if (localVal === driverId || serverVal === driverId) return true;
      }
    }

    const dk = driverDayVehicleKey(date, driverId);
    if (!localVehicleByDriverDay.has(dk)) return false;

    const newV = localVehicleByDriverDay.get(dk) ?? null;
    const placement = findDriverPlacementOnDate(localShifts, date, driverId);
    let oldV: string | null = null;
    if (placement) {
      oldV =
        shifts.find(
          (s) =>
            s.shift_date === date &&
            s.course_id === placement.courseId &&
            s.slot === placement.slot,
        )?.vehicle_id ?? null;
    }
    return newV !== oldV;
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
              列幅は固定で略記が「…」省略されます（ホバーで詳細）。上部でコース、下部で車両（ナンバー）を指定します。「車両管理」でドライバーと車両を紐付けた車だけ選べます。
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-lg border border-slate-300 overflow-hidden bg-white">
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
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-slate-300 ${
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

        {canWrite && (
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                autoSaving > 0 ? "bg-amber-400 animate-pulse" : "bg-emerald-500"
              }`}
            />
            {autoSaving > 0 ? "自動保存中…" : "変更は自動保存されます"}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <div className="bg-white rounded-lg border border-slate-200/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-x-auto table-scroll">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="border-b border-slate-200/95">
                    <th className="py-2 px-2 w-32">
                      <Skeleton className="h-4 w-16" />
                    </th>
                    {[...Array(8)].map((_, i) => (
                      <th key={i} className="py-2 px-1">
                        <Skeleton className="h-4 w-12 mx-auto" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...Array(6)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-200">
                      <td className="py-2 px-2">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      {[...Array(8)].map((_, j) => (
                        <td key={j} className="py-2 px-1">
                          <Skeleton className="h-8 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-slate-200/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-x-auto table-scroll">
              <table className="w-full text-sm min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/95">
                    <th className="sticky left-0 z-20 py-2.5 px-3 text-left font-medium text-slate-600 min-w-[9rem] bg-slate-50/95 border-r border-slate-200/95">
                      ドライバー
                    </th>
                    {displayDates.map((date) => {
                      const tone = shiftDayTone(date);
                      return (
                        <th
                          key={date}
                          className={`${SHIFT_COL_WIDTH_CLASS} border-l border-slate-200/90 px-1 py-2 text-center font-medium overflow-hidden align-top ${tone.header}`}
                        >
                          <span className="line-clamp-2 leading-tight break-words" title={formatDate(date)}>
                            {formatDate(date)}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {driversWithCourses.map((driver) => {
                    return (
                      <tr key={driver.id} className="border-b border-slate-200/90 last:border-b-0">
                        <td className="sticky left-0 z-10 bg-white py-2 px-3 align-middle border-r border-slate-200/95">
                          <span className="font-medium text-slate-800">{getDisplayName(driver)}</span>
                        </td>
                        {displayDates.map((date) => {
                          const tone = shiftDayTone(date);
                          const off = isDriverOffDay(driver.id, date);
                          const placements = findDriverPlacementsOnDate(localShifts, date, driver.id);
                          const assignedCourses = placements
                            .map((p) => courses.find((c) => c.id === p.courseId))
                            .filter((c): c is Course => Boolean(c))
                            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                          const hasAny = placements.length > 0;
                          // 車両は「1日1台」前提。代表 placement（先頭コース）で読み書きする
                          const placement = placements[0] ?? null;
                          const dirty = isDateDriverDirty(date, driver.id);

                          const addable = getAddableCoursesForDriverOnDate(date, driver.id);
                          const addOptions = addable.map((c) => ({
                            value: c.id,
                            label: courseShiftLabel(c),
                          }));

                          const prow =
                            placement
                              ? shifts.find(
                                  (s) =>
                                    s.shift_date === date &&
                                    s.course_id === placement.courseId &&
                                    s.slot === placement.slot,
                                )
                              : null;

                          const currentVid = getCurrentVehicleForDriverOnDate(date, driver.id);
                          const hoverVehiclePlate: VehiclePlateData | null = (() => {
                            if (!currentVid) return null;
                            const fromFleet = fleetById.get(currentVid);
                            if (fromFleet) return fromFleet;
                            const embedded =
                              prow?.vehicle_id === currentVid ? normalizeShiftVehiclesEmbed(prow).vehicles : null;
                            if (embedded) return embedded;
                            return { id: currentVid };
                          })();

                          const byPlateLine = (a: VehiclePlateData, b: VehiclePlateData) =>
                            formatPlateOneLine(a).localeCompare(formatPlateOneLine(b), "ja");

                          const linkedIds = new Set(
                            vehicleLinks
                              .filter((l) => l.driver_id === driver.id)
                              .map((l) => l.vehicle_id),
                          );
                          const sortedFleet = [...fleetVehicles].sort(byPlateLine);
                          let linkedPlates = sortedFleet.filter((v) => linkedIds.has(v.id));
                          let otherPlates = sortedFleet.filter((v) => !linkedIds.has(v.id));

                          if (currentVid && hoverVehiclePlate && !sortedFleet.some((v) => v.id === currentVid)) {
                            otherPlates = [hoverVehiclePlate, ...otherPlates].sort(byPlateLine);
                          }

                          const vehicleTitle =
                            hoverVehiclePlate && currentVid ? formatPlateOneLine(hoverVehiclePlate) : undefined;

                          return (
                            <td
                              key={`${driver.id}-${date}`}
                              className={`${SHIFT_COL_WIDTH_CLASS} border-l border-slate-200/90 px-0.5 py-0.5 ${
                                off
                                  ? "align-middle bg-amber-50"
                                  : `align-top ${tone.body}`
                              }`}
                            >
                              {off ? (
                                <div className="flex min-h-[2.75rem] items-center justify-center">
                                  <span className="text-[12px] font-semibold text-amber-900">希望休</span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-1">
                                  {/* コース欄: 割当チップ + その下に「＋」追加ボタン */}
                                  <div className="flex flex-col gap-0.5">
                                    {assignedCourses.map((course) => (
                                      <div
                                        key={course.id}
                                        title={courseAbbrevTooltip(course)}
                                        className={cn(
                                          "flex items-center gap-0.5 h-6 min-w-0 w-full shrink-0 overflow-hidden rounded-[6px] px-1",
                                          dirty && "outline outline-2 -outline-offset-2 outline-amber-400",
                                        )}
                                        style={courseCellSurface(course.color)}
                                      >
                                        <span className="flex-1 min-w-0 truncate text-[11px] font-semibold text-slate-900 leading-tight">
                                          {courseShiftLabel(course)}
                                        </span>
                                        {canWrite ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeDriverFromCourseOnDate(date, driver.id, course.id)
                                            }
                                            className="shrink-0 leading-none text-[13px] text-slate-500 hover:text-rose-600 px-0.5"
                                            title="このコースを外す"
                                            aria-label="このコースを外す"
                                          >
                                            ×
                                          </button>
                                        ) : null}
                                      </div>
                                    ))}
                                    {canWrite && addOptions.length > 0 ? (
                                      <div className="h-6 min-w-0 w-full shrink-0 overflow-hidden rounded-[6px] border border-dashed border-slate-300 bg-slate-50/80 [&_button]:h-full [&_button]:min-h-0 [&_button]:rounded-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:shadow-none [&_button]:justify-center">
                                        <CustomSelect
                                          options={addOptions}
                                          value=""
                                          onChange={(v) => {
                                            if (v) addDriverToCourseOnDate(date, driver.id, v);
                                          }}
                                          placeholder="＋"
                                          clearable={false}
                                          disabled={!canWrite}
                                          size="xs"
                                        />
                                      </div>
                                    ) : null}
                                  </div>

                                  {/* 車両欄 */}
                                  {hasAny ? (
                                    <div className="min-w-0 w-full shrink-0 overflow-hidden">
                                      <ShiftVehiclePlatePicker
                                        valueId={currentVid}
                                        displayVehicle={
                                          currentVid && hoverVehiclePlate ? hoverVehiclePlate : null
                                        }
                                        linkedPlates={linkedPlates}
                                        otherPlates={otherPlates}
                                        takenBy={(() => {
                                          const m = new Map<string, string>();
                                          const holders = vehicleHoldersByDate.get(date);
                                          if (holders) {
                                            for (const [vid, ids] of holders) {
                                              const other = ids.find((id) => id !== driver.id);
                                              if (other) {
                                                const od = drivers.find((d) => d.id === other);
                                                m.set(vid, od ? getDisplayName(od) : "別のドライバー");
                                              }
                                            }
                                          }
                                          return m;
                                        })()}
                                        onChange={(id) => setVehicleForDriverOnDate(date, driver.id, id)}
                                        disabled={!canWrite}
                                        dirty={dirty}
                                        title={vehicleTitle}
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="border-t border-slate-200 bg-slate-50/93">
                    <td className="sticky left-0 z-10 py-2 px-3 text-xs font-medium text-slate-600 bg-slate-50 border-r border-slate-200/95">
                      未割当
                    </td>
                    {displayDates.map((date) => {
                      const names = getOffDriverNamesOnDate(date);
                      const tone = shiftDayTone(date);
                      return (
                        <td
                          key={`off-${date}`}
                          className={`${SHIFT_COL_WIDTH_CLASS} border-l border-slate-200/90 px-1 py-2 text-[11px] text-slate-600 align-top overflow-hidden ${tone.body}`}
                        >
                          {names.length > 0 ? (
                            <span className="line-clamp-4 break-words">{names.join("・")}</span>
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

            <div className="bg-white rounded-lg border border-slate-200/95 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <h3 className="text-sm font-medium text-slate-700 mb-3">この期間の希望休（一覧）</h3>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {driversWithCourses.map((driver) => {
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
                <span>コース未登録のドライバーはこの表に含まれません</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-6 rounded border border-dashed border-slate-200 bg-white" />
                <span>未割当（プルダウンで選択）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-6 rounded border border-slate-300 bg-gradient-to-br from-slate-100 to-slate-200" />
                <span>割当済（コース色はコントロール周りの背景・略記／正式名はプルダウンと同じ）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-6 rounded border border-amber-400 bg-amber-50" />
                <span>未保存の変更</span>
              </div>
              <div className="flex items-center gap-1.5 basis-full md:basis-auto">
                <span className="text-slate-500">
                  車両は紐づけ一覧を優先表示し、「他の車両を追加」からマスタ上のその他の車両も選べます。
                </span>
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
            <table
              style={{
                width: "100%",
                tableLayout: "fixed",
                borderCollapse: "separate",
                borderSpacing: "0",
                fontSize: "12px",
              }}
            >
              <colgroup>
                <col style={{ width: "160px" }} />
                {displayDates.map((date) => (
                  <col key={`ex-col-${date}`} style={{ width: "128px" }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th
                    style={{
                      width: "160px",
                      textAlign: "left",
                      padding: "6px 8px",
                      fontSize: "13px",
                      color: "#6b7280",
                      background: "#f9fafb",
                      borderBottom: "2px solid #94a3b8",
                      borderRight: "1px solid #cbd5e1",
                    }}
                  >
                    ドライバー
                  </th>
                  {displayDates.map((date) => {
                    const ch = exportDayChrome(date);
                    return (
                      <th
                        key={`ex-h-${date}`}
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          background: ch.headBg,
                          color: ch.headColor,
                          fontWeight: 600,
                          fontSize: "13px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          borderBottom: "2px solid #94a3b8",
                          borderRight: "1px solid #e5e7eb",
                        }}
                      >
                        {formatDate(date)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {driversWithCourses.map((driver) => (
                  <tr key={`ex-row-${driver.id}`}>
                    <td
                      style={{
                        padding: "6px 8px",
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "#111827",
                        verticalAlign: "middle",
                        borderBottom: "1px solid #cbd5e1",
                        borderRight: "1px solid #cbd5e1",
                      }}
                    >
                      {getDisplayName(driver)}
                    </td>
                    {displayDates.map((date) => {
                      const ch = exportDayChrome(date);
                      const exPlacements = findDriverPlacementsOnDate(localShifts, date, driver.id);
                      const exCourses = exPlacements
                        .map((p) => courses.find((c) => c.id === p.courseId))
                        .filter((c): c is Course => Boolean(c))
                        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                      const placement = exPlacements[0] ?? null;
                      if (isDriverOffDay(driver.id, date)) {
                        return (
                          <td
                            key={`ex-${driver.id}-${date}`}
                            style={{
                              padding: "5px 6px",
                              textAlign: "center",
                              verticalAlign: "middle",
                              background: "#fffbeb",
                              borderBottom: "1px solid #cbd5e1",
                              borderRight: "1px solid #e5e7eb",
                            }}
                          >
                            <div
                              style={{
                                height: `${EX_CELL_CONTENT_H}px`,
                                lineHeight: `${EX_CELL_CONTENT_H}px`,
                                textAlign: "center",
                                fontSize: "13px",
                                fontWeight: 700,
                                color: "#92400e",
                              }}
                            >
                              希望休
                            </div>
                          </td>
                        );
                      }
                      if (exCourses.length === 0) {
                        return (
                          <td
                            key={`ex-${driver.id}-${date}`}
                            style={{
                              padding: "5px 6px",
                              verticalAlign: "middle",
                              background: ch.cellBg ?? "#ffffff",
                              borderBottom: "1px solid #cbd5e1",
                              borderRight: "1px solid #e5e7eb",
                            }}
                          >
                            <div
                              style={{
                                height: `${EX_CELL_CONTENT_H}px`,
                                lineHeight: `${EX_CELL_CONTENT_H}px`,
                                textAlign: "center",
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#94a3b8",
                              }}
                            >
                              指定休
                            </div>
                          </td>
                        );
                      }

                      const exVid = getCurrentVehicleForDriverOnDate(date, driver.id);
                      const prowEx =
                        placement
                          ? shifts.find(
                              (s) =>
                                s.shift_date === date &&
                                s.course_id === placement.courseId &&
                                s.slot === placement.slot,
                            )
                          : null;
                      const exPlate: VehiclePlateData | null = (() => {
                        if (!exVid) return null;
                        const f = fleetById.get(exVid);
                        if (f) return f;
                        const emb =
                          prowEx?.vehicle_id === exVid ? normalizeShiftVehiclesEmbed(prowEx).vehicles : null;
                        return emb ?? null;
                      })();
                      const plateLine = exPlate ? formatPlateOneLine(exPlate) : "";

                      return (
                        <td
                          key={`ex-${driver.id}-${date}`}
                          style={{
                            padding: "5px 6px",
                            verticalAlign: "middle",
                            background: ch.cellBg ?? "#ffffff",
                            borderBottom: "1px solid #cbd5e1",
                            borderRight: "1px solid #e5e7eb",
                          }}
                        >
                          <div style={{ minHeight: `${EX_CELL_CONTENT_H}px` }}>
                            {exCourses.map((course, ci) => (
                              <div
                                key={course.id}
                                style={{
                                  boxSizing: "border-box",
                                  borderRadius: "6px",
                                  padding: "0 6px",
                                  marginTop: ci === 0 ? 0 : `${EX_CELL_GAP}px`,
                                  height: `${EX_COURSE_H}px`,
                                  lineHeight: `${EX_COURSE_H}px`,
                                  fontSize: "13px",
                                  fontWeight: 700,
                                  color: "#0f172a",
                                  textAlign: "center",
                                  overflow: "hidden",
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  ...courseCellSurfaceExport(course.color),
                                }}
                                title={`${courseShiftLabel(course)}｜${course.name}`}
                              >
                                {courseShiftLabel(course)}
                              </div>
                            ))}
                            <div
                              style={{
                                boxSizing: "border-box",
                                marginTop: `${EX_CELL_GAP}px`,
                                height: `${EX_PLATE_H}px`,
                                lineHeight: `${EX_PLATE_H}px`,
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "#475569",
                                textAlign: "center",
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                textOverflow: "ellipsis",
                              }}
                              title={plateLine || undefined}
                            >
                              {plateLine}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontWeight: 700,
                      fontSize: "13px",
                      color: "#4b5563",
                      background: "#f9fafb",
                      verticalAlign: "top",
                      borderTop: "2px solid #94a3b8",
                      borderRight: "1px solid #cbd5e1",
                    }}
                  >
                    未割当
                  </td>
                  {displayDates.map((date) => {
                    const names = getOffDriverNamesOnDate(date);
                    const ch = exportDayChrome(date);
                    return (
                      <td
                        key={`ex-off-${date}`}
                        style={{
                          padding: "5px 4px",
                          fontSize: "12px",
                          lineHeight: 1.5,
                          color: "#64748b",
                          verticalAlign: "top",
                          wordBreak: "break-word",
                          background: ch.cellBg ?? "#fafafa",
                          borderTop: "2px solid #94a3b8",
                          borderRight: "1px solid #e5e7eb",
                        }}
                      >
                        {names.length ? names.join("・") : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
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
