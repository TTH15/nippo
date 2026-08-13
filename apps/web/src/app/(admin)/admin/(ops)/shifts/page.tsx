"use client";

import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight, faFileImport } from "@fortawesome/free-solid-svg-icons";
import { isJapanPublicHolidayYmd } from "@/lib/japanHolidays";
import { todayJST } from "@/lib/date";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { AutoSaveTextInput } from "@/lib/components/AutoSaveTextInput";
import { useCellCursors, type CellPeer } from "@/lib/realtime/cellCursors";
import { useApi } from "@/lib/useApi";
import { getDisplayName } from "@/lib/displayName";
import { hasCapability } from "@/lib/capabilities";
import { slotDisplayLabel } from "@/lib/timeSlot";
import {
  formatPlateNumeric,
  VehiclePlate,
  type VehiclePlateData,
} from "@/lib/components/VehiclePlate";
import { summarizeHistory, type ShiftLog } from "@/server/shiftRequests/diff";
import { cn } from "@/lib/ui/utils";
import { TimePicker } from "@/lib/ui/time-picker";
import { Check, ChevronDown, Download, RefreshCw, Settings } from "lucide-react";
import ShiftSubmitSettingsModal from "./ShiftSubmitSettingsModal";
import ShiftImportModal, { isImportableShiftFile, mergeImportFiles } from "./ShiftImportModal";
import { registerJapaneseFont } from "@/lib/pdfJapaneseFont";
import { drawShiftPdf, renderShiftCanvas, type ShiftPdfData, type ExCell } from "@/lib/shiftPdf";
import type { SpotJob } from "../spot-jobs/types";

type Course = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  max_drivers?: number | null;
  /** コース編集画面の「略記」。未設定時はコース名を表示 */
  summary_title?: string | null;
  slot_id?: string | null;
  /** A2 時間モデル: コース標準の集合場所・集合/着車/終業時刻（NULL=未設定） */
  meeting_place?: string | null;
  meeting_time?: string | null;
  arrival_time?: string | null;
  end_time?: string | null;
};

/** DB の time 値（"HH:MM:SS"）を input type=time 用の "HH:MM" へ。 */
function toTimeInputValue(v: string | null | undefined): string {
  return v ? v.slice(0, 5) : "";
}

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
  const base = abbr !== course.name ? `${abbr}（${course.name}）` : abbr;
  const times = [
    course.meeting_time ? `集合 ${toTimeInputValue(course.meeting_time)}` : null,
    course.arrival_time ? `着車 ${toTimeInputValue(course.arrival_time)}` : null,
    course.end_time ? `終業 ${toTimeInputValue(course.end_time)}` : null,
    course.meeting_place ? `集合場所 ${course.meeting_place}` : null,
  ].filter(Boolean);
  return times.length ? `${base}\n${times.join("・")}` : base;
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
function shiftDayTone(dateStr: string, todayStr?: string): { header: string; body: string } {
  // 「今日」は曜日・祝日より優先してやんわり強調（PC/モバイル共通）。
  if (todayStr && dateStr.trim() === todayStr) {
    return {
      header: "text-amber-900 bg-amber-100/90 font-semibold",
      body: "bg-amber-50/60",
    };
  }
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

/**
 * シフトセル編集ポップオーバー内の「車両選択」インライン一覧。
 * 入れ子ポップオーバーを避けるため、車両なし／他社車両／紐づけ／その他を
 * その場のボタン列として表示する（選択しても親の編集ポップオーバーは閉じない）。
 */
function VehicleOptionList({
  valueId,
  isExternal,
  linkedPlates,
  otherPlates,
  takenBy,
  loanedIds,
  onChange,
  onSelectExternal,
  disabled,
}: {
  valueId: string | null;
  /** 他社車両を利用フラグ */
  isExternal?: boolean;
  linkedPlates: VehiclePlateData[];
  otherPlates: VehiclePlateData[];
  /** その日すでに他ドライバーが使用中の車両 id → 使用者名 */
  takenBy?: Map<string, string>;
  /** その日貸出中の車両 id（紐付け不可） */
  loanedIds?: Set<string>;
  onChange: (id: string | null) => void;
  onSelectExternal?: () => void;
  disabled?: boolean;
}) {
  const row = (v: VehiclePlateData) => {
    const selected = valueId === v.id;
    const isLoaned = loanedIds?.has(v.id) ?? false;
    const takenByName = !selected ? takenBy?.get(v.id) : undefined;
    // 他ドライバー使用中はクリック可（確認後に重複割り当て）。貸出中のみ不可。
    return (
      <button
        key={v.id}
        type="button"
        disabled={disabled || isLoaned}
        title={
          isLoaned
            ? "貸出中"
            : takenByName
              ? `${takenByName} さんが使用中（クリックで重複割り当ての確認）`
              : undefined
        }
        className={cn(
          // 3状態を「濃さ」で明確に分ける:
          //   選択中   … そのまま＋枠＋チェック
          //   選択可能 … そのまま（減光しない。ここを薄くすると使用不可と区別がつかない）
          //   使用不可 … グレースケール＋減光（黄色いプレートが灰色になるので一目で分かる）
          "relative w-full rounded-md p-0.5 flex flex-col items-center gap-0.5 transition-all",
          isLoaned || takenByName
            ? "grayscale opacity-45"
            : selected
              ? "bg-slate-900/5 ring-2 ring-slate-900"
              : "hover:bg-slate-50/90",
          isLoaned && "cursor-not-allowed",
        )}
        onClick={() => {
          if (isLoaned) return;
          onChange(v.id);
        }}
      >
        <div className="relative w-full">
          <VehiclePlate vehicle={v} compact className="!max-w-[12rem] w-full min-w-0 pointer-events-none mx-auto" />
          {selected && (
            // プレート上に重ねる（プレート自体が黒地で、下の余白だけでは目立たないため）
            <span className="absolute -right-0.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white shadow ring-2 ring-white">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
          )}
          {/* 使用不可の理由はプレートに重ねる。グリッドの上下行でどちらの車両の
              ラベルか紛れるのを防ぐ（グレースケールの上なので赤が読める）。 */}
          {(isLoaned || takenByName) && (
            <span className="absolute inset-x-0 bottom-0 bg-white/85 px-1 py-0.5 text-[9px] font-bold leading-none text-rose-600">
              {isLoaned ? "貸出中" : `${takenByName} さん使用中`}
            </span>
          )}
        </div>
        {selected && (
          <span className="text-[9px] font-bold text-slate-900 leading-none pb-0.5">選択中</span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex-1 text-center text-[11px] py-1.5 px-2 rounded-md border transition-colors",
            // 選択中＝濃色（同ファイルの軸/密度トグルと同じ語彙）
            !valueId && !isExternal
              ? "bg-slate-800 border-slate-800 font-medium text-white"
              : "border-slate-200 text-slate-600 hover:bg-slate-50",
          )}
          onClick={() => onChange(null)}
        >
          {!valueId && !isExternal ? "✓ 車両なし" : "車両なし"}
        </button>
        {onSelectExternal && (
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex-1 text-center text-[11px] py-1.5 px-2 rounded-md border transition-colors",
              isExternal
                ? "bg-amber-500 border-amber-500 font-medium text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
            onClick={() => onSelectExternal()}
          >
            {isExternal ? "✓ 他社車両" : "他社車両"}
          </button>
        )}
      </div>
      {linkedPlates.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="px-1 text-[10px] font-medium text-slate-500">紐づけ車両</p>
          <div className="grid grid-cols-2 gap-1">{linkedPlates.map((v) => row(v))}</div>
        </div>
      )}
      {otherPlates.length > 0 && (
        <div className="border-t border-slate-200/80 pt-1.5">
          <p className="px-1 pb-1 text-[10px] font-semibold text-slate-600">その他の車両</p>
          <p className="px-1 pb-1 text-[9px] leading-snug text-slate-500">全社マスタ・未紐づけ含む</p>
          <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto">{otherPlates.map((v) => row(v))}</div>
        </div>
      )}
    </div>
  );
}

/**
 * 折りたたみ可能なセクション（閲覧＝サマリのみ／開く＝中身）。
 * 二次情報（凡例・車両貸出表など）を既定で畳んで画面の情報密度を下げる。
 */
function CollapsibleSection({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-slate-200/95 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-700">{title}</span>
          {hint ? <span className="ml-2 text-[11px] text-slate-400">{hint}</span> : null}
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-slate-200/80 p-4">{children}</div>
    </details>
  );
}

/** シフト一覧の「日」列・セルの共通幅（コース名・ナンバーが省略されにくいよう少し広め） */
const SHIFT_COL_WIDTH_CLASS =
  "w-[7.25rem] min-w-[7.25rem] max-w-[7.25rem] box-border";

/**
 * 「今日」の列を罫線で強調するための inset 影。
 * border-collapse の影響を受けず左右に太い縦罫を引く（用途別に上端・下端も付与）。
 */
const TODAY_RULE_SIDES = "shadow-[inset_3px_0_0_#f59e0b,inset_-3px_0_0_#f59e0b]";
const TODAY_RULE_TOP = "shadow-[inset_3px_0_0_#f59e0b,inset_-3px_0_0_#f59e0b,inset_0_3px_0_#f59e0b]";
const TODAY_RULE_BOTTOM = "shadow-[inset_3px_0_0_#f59e0b,inset_-3px_0_0_#f59e0b,inset_0_-3px_0_#f59e0b]";

type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
  /** ドライバー名簿と同じ No.。API が list_no 昇順で返すため、画面側では並べ替えない */
  list_no?: number | null;
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
  uses_external_vehicle?: boolean;
  /** FK vehicle_id のネスト（0〜1台） */
  vehicles?: VehiclePlateData | VehiclePlateData[] | null;
  /** A2 時間モデル: 個別上書き（NULL=コース標準） */
  meeting_place?: string | null;
  meeting_time?: string | null;
  arrival_time?: string | null;
  end_time?: string | null;
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
  slot_id: string | null; // 便（時間帯）。NULL=全休。
};

type RequestSlot = { id: string; name: string; startTime: string | null; endTime: string | null };

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

// 同時編集カーソル: セル右上に「そのセルを触っている人」の色付きバッジを重ねる。
function CellPeersBadge({ peers }: { peers?: CellPeer[] }) {
  if (!peers || peers.length === 0) return null;
  return (
    <span className="pointer-events-none absolute -top-1.5 right-0.5 z-20 flex gap-1">
      {peers.map((p) => (
        <span
          key={p.id}
          className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow"
          style={{ backgroundColor: p.color }}
        >
          {p.name}
        </span>
      ))}
    </span>
  );
}

export default function ShiftsPage() {
  const [canWrite, setCanWrite] = useState(false);
  // 配車（車両割当）はシフト編集と独立の can_dispatch でゲート（A1）。
  const [canDispatch, setCanDispatch] = useState(false);
  // 貸出は車両管理（can_manage_vehicles）でも操作できる（配車 or 車両管理のどちらか）。
  const [canManageVehicles, setCanManageVehicles] = useState(false);
  const canLoan = canDispatch || canManageVehicles;
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  // 同時編集カーソル（誰がどのセルを触っているか）。表示中は自動接続・未設定なら黙って無効。
  const [presenceName] = useState(() => getStoredDriver()?.name ?? "運営");
  const cursors = useCellCursors({ scope: "shifts", selfName: presenceName });
  // シフト表（PDF/画像）の AI 取り込み。専用ボタンは置かず、画面へのドラッグ&ドロップを入口にする。
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  // ドラッグ中だけ全画面のドロップフィールドを被せる（多重 dragenter に備えて深さを数える）
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  useEffect(() => {
    if (!canWrite) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDropActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDropActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // ブラウザ既定（ファイルをそのまま開く）を常に抑止した上で、対応形式だけ受け取る
      e.preventDefault();
      dragDepthRef.current = 0;
      setDropActive(false);
      const dropped = Array.from(e.dataTransfer?.files ?? []).filter(isImportableShiftFile);
      if (dropped.length === 0) return;
      setImportFiles((prev) => mergeImportFiles(prev, dropped));
      setImportModalOpen(true);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [canWrite]);
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  // デフォルトは「今日」を含む期間（1〜15日=前半 / 16日〜=後半）
  const [period, setPeriod] = useState<Period>(() => (new Date().getDate() >= 16 ? "second" : "first"));
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [slots, setSlots] = useState<RequestSlot[]>([]);
  const [autoSaving, setAutoSaving] = useState(0);

  const [localShifts, setLocalShifts] = useState<Map<string, string | null>>(new Map());
  const [localVehicleByDriverDay, setLocalVehicleByDriverDay] = useState<Map<string, string | null>>(
    new Map(),
  );
  // 他社車両フラグの即時反映用ローカル上書き（driver×day → boolean）。
  const [localExternalByDriverDay, setLocalExternalByDriverDay] = useState<Map<string, boolean>>(new Map());
  // 車両の日毎の貸出中（{vehicle_id, loan_date}）。
  const [vehicleLoans, setVehicleLoans] = useState<{ vehicle_id: string; loan_date: string }[]>([]);
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  // 編集中のセル（date×driverId）。null＝全セル閲覧モード。
  // クリックで開いた1セルだけが編集UI（ポップオーバー）を表示する。
  const [editingCell, setEditingCell] = useState<{ date: string; driverId: string } | null>(null);
  // 未割当セルのポップオーバーを開いている日付（null＝閉）。
  const [unassignedOpenDate, setUnassignedOpenDate] = useState<string | null>(null);
  // 表示軸（A3）: driver=行がドライバー（既定）/ course=行がコースで埋まり具合を俯瞰。
  const [viewAxis, setViewAxis] = useState<"driver" | "course">("driver");
  // 表示密度（A3）: compact=コースのみ / standard=＋車両 / detail=＋集合時刻。localStorage に記憶。
  const [density, setDensity] = useState<"compact" | "standard" | "detail">("standard");
  useEffect(() => {
    const v = localStorage.getItem("shifts_view_density");
    if (v === "compact" || v === "standard" || v === "detail") setDensity(v);
  }, []);
  const changeDensity = (d: "compact" | "standard" | "detail") => {
    setDensity(d);
    localStorage.setItem("shifts_view_density", d);
  };
  // 手動リフレッシュ（A3）: 他の管理者の変更を取り込む。自動再検証は楽観更新と衝突するため手動のみ。
  const [refreshing, setRefreshing] = useState(false);
  // スマホの日別ビュー（B）: 表示中の1日。null=期間内の今日 or 先頭日にフォールバック。
  const [mobileDate, setMobileDate] = useState<string | null>(null);
  // 日別ビューの左右スワイプ（ページめくり）。指の動きに追従させるため、
  // 再描画を挟まず track の transform を直接書き換える。
  const swipeRef = useRef<{ x: number; y: number; axis: "?" | "x" | "y"; dx: number } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pendingDirRef = useRef<0 | 1 | -1>(0);
  /** 中央パネル基準の transform を設定（px=null で既定位置へ戻す） */
  const setTrackOffset = (px: number | null, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.22,1,0.36,1)" : "none";
    el.style.transform = px === null ? "translateX(-100%)" : `translateX(calc(-100% + ${px}px))`;
  };
  // 表示日が変わったら（スワイプ確定・ボタン操作とも）中央へ戻す
  useLayoutEffect(() => {
    setTrackOffset(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileDate, period, yearMonth.year, yearMonth.month]);
  // 日別ビューの絞り込みタブ。全員=在籍全員 / 稼働=割当あり / 未割当=割当なし（希望休を含む）。
  const [mobileFilter, setMobileFilter] = useState<"all" | "working" | "unassigned">("all");
  // コース軸ビューのセル（コース×日）モーダル。担当可能ドライバーの追加・解除を行う。
  const [courseCellModal, setCourseCellModal] = useState<{ courseId: string; date: string } | null>(
    null,
  );
  // 希望休セルをクリックして開く「日単位の管理モーダル」（driver×date）。
  const [offModal, setOffModal] = useState<{ driverId: string; date: string } | null>(null);
  const [offHistory, setOffHistory] = useState<ShiftLog[] | null>(null);
  const [offHistoryLoading, setOffHistoryLoading] = useState(false);

  const displayDates = useMemo(
    () =>
      period === "first"
        ? getFirstHalfDates(yearMonth.year, yearMonth.month)
        : getSecondHalfDates(yearMonth.year, yearMonth.month),
    [yearMonth.year, yearMonth.month, period],
  );

  // 一覧で「今日」をやんわり強調するための基準日（JST）。
  const today = todayJST();

  // 「＋コース」チップの並び順用: 表示期間より前35日の割当実績（API から受領）。
  const [recentAssignments, setRecentAssignments] = useState<
    { driver_id: string; course_id: string; shift_date: string }[]
  >([]);

  // SWR で取得をキャッシュし、画面遷移をまたいで保持する（再訪時の点滅をなくす）。
  // キーは期間（start〜end）依存。displayDates が未確定の間は取得しない。
  const shiftsKey = useMemo(() => {
    if (displayDates.length === 0) return null;
    const start = displayDates[0];
    const end = displayDates[displayDates.length - 1];
    return `/api/admin/shifts?start=${start}&end=${end}`;
  }, [displayDates]);

  const {
    data: shiftsData,
    isInitialLoading,
    mutate: mutateShifts,
  } = useApi<{
    courses: Course[];
    drivers: Driver[];
    shifts: Shift[];
    requests: ShiftRequest[];
    slots?: { id: string; name: string; start_time: string | null; end_time: string | null }[];
    vehicles?: VehiclePlateData[];
    vehicle_driver_links?: { driver_id: string; vehicle_id: string }[];
    vehicle_loans?: { vehicle_id: string; loan_date: string }[];
    recent_assignments?: { driver_id: string; course_id: string; shift_date: string }[];
  }>(shiftsKey, {
    // 日付グリッドで前期間のデータが新しい列に重なって見えるのを防ぐため、
    // この画面では keepPreviousData を無効化（未訪問の期間切替時のみスケルトン）。
    keepPreviousData: false,
    // 編集中のフォーカス復帰で楽観更新（localShifts 等）が消えるのを防ぐため無効化。
    revalidateOnFocus: false,
  });

  // 初回（キャッシュ未取得）のみスケルトン。再訪・キャッシュ済み期間切替では点滅しない。
  const loading = isInitialLoading;

  // 単発案件（同じ期間）。継続（コース）と同格の「仕事」としてグリッド・日別ビューに出す
  // （work-model §4,§8）。migration 129 未適用などで取得に失敗しても、この画面は通常どおり動く。
  const spotJobsKey = useMemo(() => {
    if (displayDates.length === 0) return null;
    return `/api/admin/spot-jobs?start=${displayDates[0]}&end=${displayDates[displayDates.length - 1]}`;
  }, [displayDates]);
  const { data: spotJobsData } = useApi<{ jobs: SpotJob[] }>(spotJobsKey, {
    revalidateOnFocus: false,
  });
  const spotJobs = useMemo(() => spotJobsData?.jobs ?? [], [spotJobsData]);
  const spotJobsByDate = useMemo(() => {
    const map = new Map<string, SpotJob[]>();
    for (const job of spotJobs) {
      const list = map.get(job.jobDate) ?? [];
      list.push(job);
      map.set(job.jobDate, list);
    }
    return map;
  }, [spotJobs]);
  // `${date}:${driverId}` → 参加している単発案件（ドライバー軸セル・編集モーダル用）
  const spotJobsByDriverDate = useMemo(() => {
    const map = new Map<string, SpotJob[]>();
    for (const job of spotJobs) {
      for (const m of job.members) {
        if (!m.driverId) continue;
        const key = `${job.jobDate}:${m.driverId}`;
        const list = map.get(key) ?? [];
        list.push(job);
        map.set(key, list);
      }
    }
    return map;
  }, [spotJobs]);

  // SWR が取得した生データを既存の state に同期する。
  // 楽観更新（localShifts 等）のオーバーレイはここでクリアし、サーバ最新で置き換える。
  useEffect(() => {
    if (!shiftsData) return;
    setCourses(shiftsData.courses);
    setDrivers(shiftsData.drivers);
    setShifts((shiftsData.shifts ?? []).map((s) => normalizeShiftVehiclesEmbed(s)));
    setRequests(shiftsData.requests);
    setSlots(
      (shiftsData.slots ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        startTime: s.start_time ?? null,
        endTime: s.end_time ?? null,
      })),
    );
    setFleetVehicles(Array.isArray(shiftsData.vehicles) ? shiftsData.vehicles : []);
    setVehicleLinks(shiftsData.vehicle_driver_links ?? []);
    setVehicleLoans(shiftsData.vehicle_loans ?? []);
    setRecentAssignments(shiftsData.recent_assignments ?? []);
    setLocalShifts(new Map());
    setLocalVehicleByDriverDay(new Map());
    setLocalExternalByDriverDay(new Map());
  }, [shiftsData]);

  // 書き込み後などに最新化したいときに呼ぶ（旧 load の代替）。引数(silent)は互換のため受けるが無視。
  const load = useCallback(
    (_opts?: { silent?: boolean }) => mutateShifts(),
    [mutateShifts],
  );

  // 書き込み成功後のキャッシュ確定。この画面は D&D コピーなど連続操作が多いため、
  // 1操作ごとに再取得すると通信が増え、取得結果で楽観更新が上書きされてちらつく。
  // 操作が途切れてからまとめて1回だけ再取得する。
  const revalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRevalidate = useCallback(() => {
    if (revalidateTimer.current) clearTimeout(revalidateTimer.current);
    revalidateTimer.current = setTimeout(() => {
      revalidateTimer.current = null;
      void mutateShifts();
    }, 1500);
  }, [mutateShifts]);

  useEffect(
    () => () => {
      if (revalidateTimer.current) clearTimeout(revalidateTimer.current);
    },
    [],
  );

  // 保存中にタブを閉じられると、送信中の fetch がブラウザに打ち切られる可能性がある。
  // この画面は保存ボタンが無い（即時保存）ぶん、失われたことに気づけないので警告する。
  useEffect(() => {
    if (autoSaving === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [autoSaving]);

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_shifts"));
    setCanDispatch(hasCapability("can_dispatch"));
    setCanManageVehicles(hasCapability("can_manage_vehicles"));
  }, []);

  // 表示期間に今日が含まれるとき、表を開いたら今日の列へ横スクロールして視界に入れる。
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!displayDates.includes(today)) return;
    const raf = requestAnimationFrame(() => {
      gridScrollRef.current
        ?.querySelector("th[data-today]")
        ?.scrollIntoView({ inline: "center", block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, displayDates, viewAxis]);

  // 自動保存のため未保存確認は不要。そのまま切り替える。
  const handleYearMonthChange = (value: { year: number; month: number }) => {
    setYearMonth(value);
  };

  const switchPeriod = (p: Period) => {
    setPeriod(p);
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

  // slot_id を便名に解決（NULL/不明＝「全休」）。希望休一覧/注記用。
  const slotName = (slotId: string | null): string =>
    slotId == null ? "全休" : slots.find((s) => s.id === slotId)?.name ?? "便";

  // コースの時間帯ラベル（時刻 or 便名）。終日(null)は null。
  const slotLabelById = (slotId: string | null | undefined): string | null => {
    if (!slotId) return null;
    const s = slots.find((x) => x.id === slotId);
    return s ? slotDisplayLabel(s) : null;
  };

  // 全休（slot_id=null）のみを「希望休」＝割当ブロック対象とする。便指定はブロックしない。
  const isDriverOffDay = (driverId: string, date: string) =>
    requests.some((r) => r.driver_id === driverId && r.request_date === date && r.slot_id == null);

  // 便指定の休み希望（全休以外）の便名一覧（注記表示用）。
  const getDriverSlotOffNames = (driverId: string, date: string): string[] =>
    requests
      .filter((r) => r.driver_id === driverId && r.request_date === date && r.slot_id != null)
      .map((r) => slotName(r.slot_id));

  // その日の稼働人数（いずれかのコースに割り当てられた重複排除ドライバー数）。
  const workingCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const date of displayDates) {
      const set = new Set<string>();
      for (const course of courses) {
        const maxSlots = Math.max(1, course.max_drivers ?? 1);
        for (let slot = 1; slot <= maxSlots; slot++) {
          const did = getCurrentDriverId(date, course.id, slot);
          if (did) set.add(did);
        }
      }
      m.set(date, set.size);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayDates, courses, localShifts, shifts]);

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

  // その日に貸出中の車両 id（date → Set<vehicle_id>）。
  const loanedByDate = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of vehicleLoans) {
      if (!m.has(l.loan_date)) m.set(l.loan_date, new Set());
      m.get(l.loan_date)!.add(l.vehicle_id);
    }
    return m;
  }, [vehicleLoans]);

  // 他社車両フラグの現在値（ローカル上書き優先）。
  const getCurrentExternalForDriverOnDate = (date: string, driverId: string): boolean => {
    const dk = driverDayVehicleKey(date, driverId);
    if (localExternalByDriverDay.has(dk)) return localExternalByDriverDay.get(dk) === true;
    const placement = findDriverPlacementOnDate(localShifts, date, driverId);
    if (!placement) return false;
    const row = shifts.find(
      (s) => s.shift_date === date && s.course_id === placement.courseId && s.slot === placement.slot,
    );
    return row?.uses_external_vehicle === true;
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

  // 実際の割り当て反映（競合チェックは呼び出し側）。
  const applyVehicleForDriverOnDate = (date: string, driverId: string, vehicleId: string | null) => {
    const dk = driverDayVehicleKey(date, driverId);
    setLocalVehicleByDriverDay((prev) => new Map(prev).set(dk, vehicleId));
    // 車両を選んだら他社車両フラグは解除する。
    setLocalExternalByDriverDay((prev) => new Map(prev).set(dk, false));
    // 車両は1日1台。当該ドライバーの全コース行へ同じ車両を即時保存
    for (const p of findDriverPlacementsOnDate(localShifts, date, driverId)) {
      persistVehicle(date, p.courseId, p.slot, vehicleId, false);
    }
  };

  const setVehicleForDriverOnDate = (date: string, driverId: string, vehicleId: string | null) => {
    if (!canDispatch) return;
    if (vehicleId) {
      // 貸出中は割り当て不可（従来通り）。
      if (loanedByDate.get(date)?.has(vehicleId)) {
        setErrorState({
          title: "車両を割り当てできません",
          message: "この車両は同じ日が貸出中のため、シフトに紐付けできません。",
        });
        return;
      }
      // 他ドライバーと重複する場合は、ブロックせず確認（OKなら重複割り当て）。
      // 編集モーダルは中央固定になったので閉じずに、ConfirmDialog をその上へ重ねる。
      const holder = getOtherVehicleHolderName(date, vehicleId, driverId);
      if (holder) {
        setConfirmState({
          message:
            `この車両は同じ日に ${holder} さんへ割り当て済みです。重複して割り当てますか？\n` +
            `（時間帯を分けて同じ車両を使う場合などに使用してください）`,
          onConfirm: () => applyVehicleForDriverOnDate(date, driverId, vehicleId),
        });
        return;
      }
    }
    applyVehicleForDriverOnDate(date, driverId, vehicleId);
  };

  const isVehicleLoaned = (vehicleId: string, date: string) => loanedByDate.get(date)?.has(vehicleId) ?? false;

  // ============================================================
  // 貸出表の一括設定（A3）: セルを押しながらなぞると、始点の反転値（ON/OFF）で塗る。
  // ON へ塗るとき、同日のシフトに紐付いている車両はスキップし、離した時にまとめて通知。
  // ============================================================
  const loanPaintRef = useRef<{ loaned: boolean; skipped: number } | null>(null);

  const applyLoanPaint = (vehicleId: string, date: string) => {
    const paint = loanPaintRef.current;
    if (!paint) return;
    if (isVehicleLoaned(vehicleId, date) === paint.loaned) return;
    if (paint.loaned && vehicleHoldersByDate.get(date)?.has(vehicleId)) {
      paint.skipped++;
      return;
    }
    void toggleVehicleLoan(vehicleId, date);
  };

  const startLoanPaint = (vehicleId: string, date: string) => {
    if (!canLoan) return;
    loanPaintRef.current = { loaned: !isVehicleLoaned(vehicleId, date), skipped: 0 };
    applyLoanPaint(vehicleId, date);
  };

  useEffect(() => {
    const endLoanPaint = () => {
      const paint = loanPaintRef.current;
      if (!paint) return;
      loanPaintRef.current = null;
      if (paint.skipped > 0) {
        setErrorState({
          title: "一部は貸出中にできませんでした",
          message:
            `${paint.skipped} 件は同日のシフトに車両が紐付いているため、貸出中にできません。\n` +
            "先にシフト側の紐付けを解除してください。",
        });
      }
    };
    window.addEventListener("mouseup", endLoanPaint);
    return () => window.removeEventListener("mouseup", endLoanPaint);
  }, []);

  /** 車両の日毎の貸出中をトグル（楽観更新＋失敗時リロード）。 */
  const toggleVehicleLoan = async (vehicleId: string, date: string) => {
    if (!canLoan) return;
    const loaned = !isVehicleLoaned(vehicleId, date);
    setVehicleLoans((prev) =>
      loaned
        ? [...prev, { vehicle_id: vehicleId, loan_date: date }]
        : prev.filter((l) => !(l.vehicle_id === vehicleId && l.loan_date === date)),
    );
    setAutoSaving((n) => n + 1);
    try {
      await apiFetch("/api/admin/shifts/vehicle-loans", {
        method: "POST",
        body: JSON.stringify({ vehicleId, date, loaned }),
      });
      scheduleRevalidate(); // キャッシュ確定（連続操作をまとめる）
    } catch (e) {
      setErrorState({
        title: "貸出設定に失敗しました",
        message: e instanceof Error ? e.message : "もう一度お試しください。",
      });
      void load({ silent: true });
    } finally {
      setAutoSaving((n) => Math.max(0, n - 1));
    }
  };

  /** 他社車両フラグの設定（ON時は自社車両をクリア）。 */
  const setExternalForDriverOnDate = (date: string, driverId: string, external: boolean) => {
    if (!canDispatch) return;
    const dk = driverDayVehicleKey(date, driverId);
    setLocalExternalByDriverDay((prev) => new Map(prev).set(dk, external));
    if (external) setLocalVehicleByDriverDay((prev) => new Map(prev).set(dk, null));
    for (const p of findDriverPlacementsOnDate(localShifts, date, driverId)) {
      persistVehicle(date, p.courseId, p.slot, external ? null : getCurrentVehicleForDriverOnDate(date, driverId), external);
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
    // 割当を即時保存し、既存の当日車両は配車権限がある場合のみ新しい行へ引き継ぐ（車両は1日1台）
    const carriedVehicleId = getCurrentVehicleForDriverOnDate(date, driverId);
    void persistAssignment(date, courseId, slot, driverId).then((ok) => {
      if (ok && carriedVehicleId) persistVehicle(date, courseId, slot, carriedVehicleId, false);
    });
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
    // 外したセルを即時保存（driverId=null。車両はサーバー側で連動クリア）
    for (const slot of clearedSlots) void persistAssignment(date, courseId, slot, null);
  };

  // ============================================================
  // D&D コピー（A3）: 割当済みセルをドラッグしてコース割当を複製する。
  //   同一ドライバーの行 → ドロップ位置までの範囲フィル（連日コピー）
  //   別ドライバーのセル → その日へ単セルコピー（担当可能コースのみ）
  // 車両・時間上書きは複製しない（車両は日毎の配車、時間はコース標準が効く）。
  // ============================================================
  const [dragSource, setDragSource] = useState<{
    date: string;
    driverId: string;
    courseIds: string[];
  } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ date: string; driverId: string } | null>(null);

  /** ドロップ可能か（自セル・全休日・担当可能コースなしは不可）。 */
  const isValidDropTarget = (date: string, driverId: string): boolean => {
    if (!dragSource || !canWrite) return false;
    if (dragSource.date === date && dragSource.driverId === driverId) return false;
    if (isDriverOffDay(driverId, date)) return false;
    if (driverId !== dragSource.driverId) {
      const d = drivers.find((x) => x.id === driverId);
      if (!d) return false;
      const allowed = new Set(getDriverCourseIds(d));
      if (!dragSource.courseIds.some((c) => allowed.has(c))) return false;
    }
    return true;
  };

  /**
   * コース割当を対象ドライバー×対象日へ複製する。希望休・担当外・定員満はスキップし、
   * スキップがあった場合のみまとめて通知する（1件ずつダイアログは出さない）。
   */
  const copyCoursesTo = (srcCourseIds: string[], targetDriverId: string, targetDates: string[]) => {
    const driver = drivers.find((d) => d.id === targetDriverId);
    if (!driver) return;
    const allowed = new Set(getDriverCourseIds(driver));
    const notes: string[] = [];
    let applied = 0;
    const updates = new Map<string, string>(); // cellKey → driverId（同一バッチ内の空き枠判定にも使う）
    for (const date of targetDates) {
      if (isDriverOffDay(targetDriverId, date)) {
        notes.push(`${formatDate(date)}: 希望休（全休）のためスキップ`);
        continue;
      }
      for (const courseId of srcCourseIds) {
        const course = courses.find((c) => c.id === courseId);
        if (!course) continue;
        if (!allowed.has(courseId)) {
          notes.push(`${formatDate(date)} ${courseShiftLabel(course)}: 担当可能コースでないためスキップ`);
          continue;
        }
        // すでに同コースに入っている日は黙ってスキップ（コピーの意図は満たされている）
        if (
          findDriverPlacementsOnDate(localShifts, date, targetDriverId).some(
            (p) => p.courseId === courseId,
          )
        ) {
          continue;
        }
        const maxSlots = Math.max(1, course.max_drivers ?? 1);
        let slot: number | null = null;
        for (let s = 1; s <= maxSlots; s++) {
          const k = getCellKey(date, courseId, s);
          const eff = updates.has(k) ? updates.get(k) : getEffectiveIdFromMap(localShifts, date, courseId, s);
          if (!eff) {
            slot = s;
            break;
          }
        }
        if (slot == null) {
          notes.push(`${formatDate(date)} ${courseShiftLabel(course)}: 定員に空きがないためスキップ`);
          continue;
        }
        updates.set(getCellKey(date, courseId, slot), targetDriverId);
        applied++;
        void persistAssignment(date, courseId, slot, targetDriverId);
      }
    }
    if (updates.size > 0) {
      setLocalShifts((prev) => {
        const next = new Map(prev);
        for (const [k, v] of updates) next.set(k, v);
        return next;
      });
    }
    if (notes.length > 0) {
      setErrorState({
        title: "一部コピーできませんでした",
        message: `${applied} 件コピーしました。以下はスキップしています。\n\n${notes.join("\n")}`,
      });
    }
  };

  const handleCellDrop = (targetDate: string, targetDriverId: string) => {
    if (!dragSource) return;
    const { date: srcDate, driverId: srcDriverId, courseIds } = dragSource;
    setDragSource(null);
    setDragOverCell(null);
    if (courseIds.length === 0) return;
    if (targetDriverId === srcDriverId) {
      // 横フィル: ドラッグ元〜ドロップ位置の全日（元日を除く）へ連日コピー
      const si = displayDates.indexOf(srcDate);
      const ti = displayDates.indexOf(targetDate);
      if (si < 0 || ti < 0) return;
      const [a, b] = si < ti ? [si, ti] : [ti, si];
      const dates = displayDates.slice(a, b + 1).filter((d) => d !== srcDate);
      copyCoursesTo(courseIds, srcDriverId, dates);
    } else {
      copyCoursesTo(courseIds, targetDriverId, [targetDate]);
    }
  };

  /**
   * シフト割当1セル分を即時バックグラウンド保存（楽観的・保存ボタン不要）。
   * 値は呼び出し側が明示指定（setState 直後で state が未反映のため）。
   * 失敗時は最新状態を再取得して巻き戻す。成功可否を返す（車両引き継ぎの連鎖用）。
   */
  const persistAssignment = (
    date: string,
    courseId: string,
    slot: number,
    driverId: string | null,
  ): Promise<boolean> => {
    if (!canWrite) return Promise.resolve(false);
    setAutoSaving((n) => n + 1);
    return apiFetch("/api/admin/shifts", {
      method: "POST",
      body: JSON.stringify({ shiftDate: date, courseId, slot, driverId }),
    })
      .then(() => {
        scheduleRevalidate();
        return true;
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
        return false;
      })
      .finally(() => setAutoSaving((n) => Math.max(0, n - 1)));
  };

  /**
   * 車両割当（配車）1セル分を即時保存。独立エンドポイント（can_dispatch ゲート）へ送る。
   * 失敗時は最新状態を再取得して巻き戻す。
   */
  const persistVehicle = (
    date: string,
    courseId: string,
    slot: number,
    vehicleId: string | null,
    usesExternal?: boolean,
  ) => {
    if (!canDispatch) return;
    setAutoSaving((n) => n + 1);
    apiFetch("/api/admin/shifts/vehicle", {
      method: "POST",
      body: JSON.stringify({ shiftDate: date, courseId, slot, vehicleId, usesExternalVehicle: usesExternal ?? false }),
    })
      .then(() => scheduleRevalidate())
      .catch((e) => {
        console.error(e);
        setErrorState({
          title: "車両の保存に失敗しました",
          message:
            "車両の割当をサーバーに保存できませんでした。最新の状態に戻します。\n通信状況を確認のうえ、もう一度お試しください。",
          detail: e instanceof Error ? e.message : undefined,
        });
        void load({ silent: true });
      })
      .finally(() => setAutoSaving((n) => Math.max(0, n - 1)));
  };

  /**
   * シフト行の時間・集合場所の個別上書きを即時保存（A2）。null=上書き解除でコース標準に戻る。
   * ローカル shifts へ楽観反映し、応答の行で同期する（行が未取得ならそこで追補）。
   */
  const persistTimes = (
    date: string,
    courseId: string,
    slot: number,
    patch: {
      meetingPlace?: string | null;
      meetingTime?: string | null;
      arrivalTime?: string | null;
      endTime?: string | null;
    },
  ) => {
    if (!canWrite) return;
    setShifts((prev) =>
      prev.map((s) =>
        s.shift_date === date && s.course_id === courseId && s.slot === slot
          ? {
              ...s,
              ...(patch.meetingPlace !== undefined ? { meeting_place: patch.meetingPlace } : {}),
              ...(patch.meetingTime !== undefined ? { meeting_time: patch.meetingTime } : {}),
              ...(patch.arrivalTime !== undefined ? { arrival_time: patch.arrivalTime } : {}),
              ...(patch.endTime !== undefined ? { end_time: patch.endTime } : {}),
            }
          : s,
      ),
    );
    setAutoSaving((n) => n + 1);
    apiFetch<{ shift: Shift }>("/api/admin/shifts/times", {
      method: "POST",
      body: JSON.stringify({ shiftDate: date, courseId, slot, ...patch }),
    })
      .then((res) => {
        const row = res.shift;
        setShifts((prev) => {
          if (prev.some((s) => s.id === row.id)) {
            return prev.map((s) =>
              s.id === row.id
                ? {
                    ...s,
                    meeting_place: row.meeting_place ?? null,
                    meeting_time: row.meeting_time ?? null,
                    arrival_time: row.arrival_time ?? null,
                    end_time: row.end_time ?? null,
                  }
                : s,
            );
          }
          // 割当直後などでローカル未取得の行は応答で追補（drivers 等のネストは無いが表示には未使用）
          return [...prev, { ...row, drivers: row.drivers ?? null }];
        });
        scheduleRevalidate();
      })
      .catch((e) => {
        console.error(e);
        setErrorState({
          title: "時間の保存に失敗しました",
          message:
            "時間・集合場所の変更をサーバーに保存できませんでした。最新の状態に戻します。\n通信状況を確認のうえ、もう一度お試しください。",
          detail: e instanceof Error ? e.message : undefined,
        });
        void load({ silent: true });
      })
      .finally(() => setAutoSaving((n) => Math.max(0, n - 1)));
  };

  // 希望休セル → 日単位の管理モーダルを開き、その日の変更履歴を取得。
  const openOffModal = (driverId: string, date: string) => {
    setOffModal({ driverId, date });
    setOffHistory(null);
    setOffHistoryLoading(true);
    apiFetch<{ logs: ShiftLog[] }>(
      `/api/admin/shifts/requests/history?driverId=${encodeURIComponent(driverId)}&date=${encodeURIComponent(date)}`,
    )
      .then((d) => setOffHistory(d.logs ?? []))
      .catch(() => setOffHistory([]))
      .finally(() => setOffHistoryLoading(false));
  };

  // 希望休1件を解除（確認 → DELETE → 状態反映）。一覧/モーダル共通。
  const deleteOffRequest = (driver: Driver, r: ShiftRequest) => {
    setConfirmState({
      message: `${getDisplayName(driver)} の希望休（${formatDate(r.request_date)} ${slotName(r.slot_id)}）を解除しますか？`,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/shifts/requests/${r.id}`, { method: "DELETE" });
          setRequests((prev) => prev.filter((x) => x.id !== r.id));
          scheduleRevalidate();
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
    // エクスポートの「未割当」欄。表の行順（名簿の No. 順）と同じ並びで出す
    return driversWithCourses.filter((d) => !assignedOnDate.has(d.id)).map((d) => getDisplayName(d));
  };

  /** その日に未割当（いずれのコースにも入っていない）ドライバー実体。名簿と同じ No. 順。 */
  const getUnassignedDriversOnDate = (date: string): Driver[] => {
    const assignedOnDate = new Set<string>();
    courses.forEach((course) => {
      const maxSlots = Math.max(1, course.max_drivers ?? 1);
      for (let slot = 1; slot <= maxSlots; slot++) {
        const driverId = getCurrentDriverId(date, course.id, slot);
        if (driverId) assignedOnDate.add(driverId);
      }
    });
    return driversWithCourses.filter((d) => !assignedOnDate.has(d.id));
  };

  // ドライバー×コースの割当実績（表示期間内 + 期間前35日）。「＋コース」チップで
  // 「よく入るコース」を先頭に出すための頻度・最終利用日マップ。
  const courseUsageByDriver = useMemo(() => {
    const map = new Map<string, Map<string, { count: number; last: string }>>();
    const add = (driverId: string | null, courseId: string, date: string) => {
      if (!driverId) return;
      let byCourse = map.get(driverId);
      if (!byCourse) {
        byCourse = new Map();
        map.set(driverId, byCourse);
      }
      const cur = byCourse.get(courseId);
      byCourse.set(courseId, {
        count: (cur?.count ?? 0) + 1,
        last: cur && cur.last > date ? cur.last : date,
      });
    };
    for (const s of shifts) add(s.driver_id, s.course_id, s.shift_date);
    for (const r of recentAssignments) add(r.driver_id, r.course_id, r.shift_date);
    return map;
  }, [shifts, recentAssignments]);

  /** 「＋コース」追加用: このドライバーがまだ入っていない＆定員に空きがあるコース。
   *  並びは「よく入るコース（頻度→直近）」が先、未実績は sort_order 順で後ろ。 */
  const getAddableCoursesForDriverOnDate = (date: string, driverId: string): Course[] => {
    const driver = drivers.find((d) => d.id === driverId);
    if (!driver) return [];
    const allowed = new Set(getDriverCourseIds(driver));
    const usage = courseUsageByDriver.get(driverId);
    return courses
      .filter((c) => allowed.has(c.id) && canAddDriverToCourse(date, driverId, c.id, localShifts))
      .sort((a, b) => {
        const ua = usage?.get(a.id);
        const ub = usage?.get(b.id);
        if (!!ua !== !!ub) return ua ? -1 : 1;
        if (ua && ub) {
          if (ub.count !== ua.count) return ub.count - ua.count;
          if (ua.last !== ub.last) return ua.last < ub.last ? 1 : -1;
        }
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
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

  // スマホ日別ビューで表示する日。期間を切り替えたら今日（無ければ先頭日）へ寄せる。
  const activeMobileDate =
    mobileDate && displayDates.includes(mobileDate)
      ? mobileDate
      : displayDates.includes(today)
        ? today
        : displayDates[0] ?? "";

  /** 日別ビュー用: その日の全ドライバーの状態（割当・希望休・車両）を表示名順で返す */
  const getDayRows = (date: string) =>
    driversWithCourses
      .map((driver) => {
        const placements = findDriverPlacementsOnDate(localShifts, date, driver.id);
        const assignedCourses = placements
          .map((p) => courses.find((c) => c.id === p.courseId))
          .filter((c): c is Course => Boolean(c))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const vehicleId = getCurrentVehicleForDriverOnDate(date, driver.id);
        // フリート未取得の車両は shifts のネスト（vehicles）へフォールバックし、必ず何かを出す
        const plate: VehiclePlateData | null = (() => {
          if (!vehicleId) return null;
          const fromFleet = fleetById.get(vehicleId);
          if (fromFleet) return fromFleet;
          const p0 = placements[0];
          const row = p0
            ? shifts.find(
                (s) => s.shift_date === date && s.course_id === p0.courseId && s.slot === p0.slot,
              )
            : null;
          const embedded =
            row?.vehicle_id === vehicleId ? normalizeShiftVehiclesEmbed(row).vehicles : null;
          return embedded ?? { id: vehicleId };
        })();
        return {
          driver,
          placements,
          assignedCourses,
          plate,
          isExternal: getCurrentExternalForDriverOnDate(date, driver.id),
          off: isDriverOffDay(driver.id, date),
        };
      });
    // 並べ替えはしない（driversWithCourses = API の list_no 昇順をそのまま使う）

  /** 日別ビューの1日分リスト（スワイプのプレビューで前後日も同じ関数で描く） */
  const renderDayList = (date: string) => {
    const allRows = getDayRows(date);
    const rows =
      mobileFilter === "working"
        ? allRows.filter((r) => r.placements.length > 0)
        : mobileFilter === "unassigned"
          ? allRows.filter((r) => r.placements.length === 0)
          : allRows;
    const dayJobs = spotJobsByDate.get(date) ?? [];
    return (
      <div className="space-y-3">
      {/* 単発案件（その日の全件。ゲスト・名前だけの参加者もここで見える） */}
      {dayJobs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-600">
            単発案件
          </div>
          <div className="divide-y divide-slate-100">
            {dayJobs.map((job) => (
              <a key={job.id} href="/admin/spot-jobs" className="flex items-center gap-3 px-3 py-2.5 active:bg-slate-100">
                <span className="min-w-0 flex-1 truncate rounded bg-sky-100 px-2 py-0.5 text-[12px] font-semibold text-sky-800">
                  {job.title}
                </span>
                <span className="shrink-0 text-[11px] text-slate-500">
                  {job.meetingTime ? `${job.meetingTime}〜` : ""}
                  {job.members.length > 0 ? ` ${job.members.length}名` : ""}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">該当するドライバーはいません。</p>
        ) : (
          rows.map(({ driver, placements, assignedCourses, plate, isExternal, off }) => {
            const hasAny = placements.length > 0;
            const canOpen = off ? canWrite : canWrite || (canDispatch && hasAny);
            return (
              <button
                key={driver.id}
                type="button"
                disabled={!canOpen}
                onClick={() =>
                  off ? openOffModal(driver.id, date) : setEditingCell({ date, driverId: driver.id })
                }
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left",
                  off && "bg-amber-50/60",
                  canOpen ? "active:bg-slate-100" : "cursor-default",
                )}
              >
                <span className="w-16 shrink-0 truncate text-sm font-semibold text-slate-900">
                  {getDisplayName(driver)}
                </span>
                {/* 名前・コース・車両を1行に収め、行の高さを揃える */}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  {off ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-800">
                      希望休
                    </span>
                  ) : hasAny ? (
                    assignedCourses.map((c) => (
                      <span
                        key={c.id}
                        className="max-w-full truncate rounded-[6px] px-2 py-0.5 text-[12px] font-semibold text-slate-900"
                        style={courseCellSurface(c.color)}
                      >
                        {courseShiftLabel(c)}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12px] text-slate-400">
                      未割当{canWrite ? "（タップで割当）" : ""}
                    </span>
                  )}
                </span>
                {hasAny && (
                  <span className="flex w-[5.5rem] shrink-0 justify-end">
                    {plate ? (
                      // w-full が無いと flex アイテムとして幅が決まらず（内部が w-full のため）
                      // プレートが潰れて見えなくなる
                      <VehiclePlate
                        vehicle={plate}
                        compact
                        className="w-full !max-w-none min-w-0 pointer-events-none"
                      />
                    ) : isExternal ? (
                      <span className="text-[11px] font-semibold text-amber-600">他社車両</span>
                    ) : (
                      <span className="text-[11px] text-slate-400">車両なし</span>
                    )}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      </div>
    );
  };

  // ベクターPDF用に、エクスポート表の内容を素データへ変換（描画ロジックと分離）。
  const buildShiftPdfData = (): ShiftPdfData => {
    const rows = driversWithCourses.map((driver) => {
      const cells: ExCell[] = displayDates.map((date) => {
        if (isDriverOffDay(driver.id, date)) return { kind: "off" };
        const placements = findDriverPlacementsOnDate(localShifts, date, driver.id);
        const exCourses = placements
          .map((p) => courses.find((c) => c.id === p.courseId))
          .filter((c): c is Course => Boolean(c))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const chrome = exportDayChrome(date);
        if (exCourses.length === 0) return { kind: "designated", bg: chrome.cellBg };
        const placement = placements[0] ?? null;
        const exVid = getCurrentVehicleForDriverOnDate(date, driver.id);
        const prow = placement
          ? shifts.find(
              (s) => s.shift_date === date && s.course_id === placement.courseId && s.slot === placement.slot,
            )
          : null;
        const exPlate: VehiclePlateData | null = (() => {
          if (!exVid) return null;
          const f = fleetById.get(exVid);
          if (f) return f;
          return prow?.vehicle_id === exVid ? normalizeShiftVehiclesEmbed(prow).vehicles ?? null : null;
        })();
        return {
          kind: "courses",
          bg: chrome.cellBg,
          plate: exPlate ? formatPlateOneLine(exPlate) : "",
          courses: exCourses.map((c) => ({
            label: courseShiftLabel(c),
            color: c.color,
            slotLabel: slotLabelById(c.slot_id) ?? undefined,
          })),
        };
      });
      return { name: getDisplayName(driver), cells };
    });
    return {
      title: `シフト表（${yearMonth.year}年${yearMonth.month}月 ${period === "first" ? "前半" : "後半"}）`,
      dateLabels: displayDates.map((d) => formatDate(d)),
      dayChrome: displayDates.map((d) => exportDayChrome(d)),
      rows,
      offLabel: "未割当",
      offRow: displayDates.map((d) => getOffDriverNamesOnDate(d).join("、")),
    };
  };

  const handleExport = async (format: "png" | "pdf") => {
    if (exporting) return;
    try {
      setExporting(true);
      const fileBase = `shifts_${yearMonth.year}-${String(yearMonth.month).padStart(2, "0")}_${period}`;

      if (format === "pdf") {
        // ベクターPDF（jsPDF で表を再描画。日本語フォントを埋め込む）。
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF("landscape", "pt", "a4");
        const fontName = await registerJapaneseFont(pdf);
        drawShiftPdf(pdf, buildShiftPdfData(), fontName);
        pdf.save(`${fileBase}.pdf`);
        return;
      }

      // PNG も PDF と同じ描画ロジックで高精細に生成（html2canvas は使わず、見た目を完全一致）。
      const canvas = await renderShiftCanvas(buildShiftPdfData());
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${fileBase}.png`;
      a.click();
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
        {/* ツールバーは PC のみ固定。スマホで固定するのは日付ナビ＋タブだけにして、
            固定領域が画面を占有して一覧が隠れるのを防ぐ */}
        <div
          className="md:sticky z-30 -mx-3 px-3 md:-mx-6 md:px-6 bg-slate-50 pt-2 -mt-1 md:border-b md:border-slate-200/80"
          style={{ top: "var(--admin-header-h, 0px)" }}
        >
        {/* 1行目: 見出し＋年月。2行目: 期間タブ＋操作ボタン（高さを抑えて表を広く見せる） */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <h1 className="text-lg md:text-xl font-bold text-slate-900 shrink-0">シフト管理</h1>
          <MonthYearPicker
            value={yearMonth}
            onChange={handleYearMonthChange}
            placeholder="年月を選択"
          />
        </div>
        <p className="hidden md:block text-xs text-slate-500 mb-2">
          セルをクリックすると、そのセルだけ編集パネルが開きコース・車両を指定できます（変更は自動保存）。「車両管理」でドライバーと車両を紐付けた車が候補の先頭に出ます。
        </p>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* 期間タブ（スマホは短いラベルで幅を節約） */}
            <div className="flex rounded-lg border border-slate-300 overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => switchPeriod("first")}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium transition-colors ${
                  period === "first"
                    ? "bg-slate-800 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                前半<span className="hidden md:inline">（1〜15日）</span>
              </button>
              <button
                type="button"
                onClick={() => switchPeriod("second")}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium transition-colors border-l border-slate-300 ${
                  period === "second"
                    ? "bg-slate-800 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                後半<span className="hidden md:inline">（16日〜）</span>
              </button>
            </div>
            {/* 表示軸の切替（A3）: ドライバー軸/コース軸。スマホは日別ビューのため非表示 */}
            <div className="hidden md:flex rounded-lg border border-slate-300 overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setViewAxis("driver")}
                className={`flex-1 sm:flex-none px-4 py-2 text-sm font-medium transition-colors ${
                  viewAxis === "driver" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                ドライバー軸
              </button>
              <button
                type="button"
                onClick={() => setViewAxis("course")}
                className={`flex-1 sm:flex-none px-4 py-2 text-sm font-medium transition-colors border-l border-slate-300 ${
                  viewAxis === "course" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                コース軸
              </button>
            </div>
            {/* 表示密度（A3）: 簡易=コースのみ / 標準=＋車両 / 詳細=＋集合時刻。スマホは日別ビューのため非表示 */}
            <div className="hidden md:flex rounded-lg border border-slate-300 overflow-hidden bg-white">
              {(
                [
                  ["compact", "簡易", "コースだけを表示（1画面の情報量を最小に）"],
                  ["standard", "標準", "コース＋車両を表示"],
                  ["detail", "詳細", "コース＋車両＋集合時刻を表示"],
                ] as const
              ).map(([key, label, title], i) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => changeDensity(key)}
                  title={title}
                  className={`flex-1 sm:flex-none px-3 py-2 text-sm font-medium transition-colors ${
                    i > 0 ? "border-l border-slate-300" : ""
                  } ${density === key ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* 操作ボタン群（エクスポート／更新／設定）は右寄せで1行にまとめる。
              シフト表の AI 取り込みはボタンではなく、画面へのファイルドロップが入口。 */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              {/* スマホは省スペースのためアイコンのみ（PC は従来のラベル付き） */}
              <button
                type="button"
                onClick={() => setExportMenuOpen((o) => !o)}
                disabled={exporting || loading}
                title="エクスポート（PNG / PDF）"
                aria-label="エクスポート"
                className="h-9 w-9 md:w-auto md:px-3 md:py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
              >
                <Download className={cn("w-4 h-4 md:hidden", exporting && "animate-pulse")} />
                <span className="hidden md:inline">{exporting ? "エクスポート中..." : "エクスポート"}</span>
                {!exporting && <ChevronDown className="hidden md:block w-3.5 h-3.5" />}
              </button>
              {exportMenuOpen && !exporting && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    <p className="px-3 pb-1 pt-0.5 text-[10px] font-medium text-slate-400">ダウンロード形式</p>
                    <button
                      type="button"
                      onClick={() => { setExportMenuOpen(false); void handleExport("png"); }}
                      className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      画像（PNG）
                    </button>
                    <button
                      type="button"
                      onClick={() => { setExportMenuOpen(false); void handleExport("pdf"); }}
                      className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      PDF
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                setRefreshing(true);
                try {
                  await load();
                } finally {
                  setRefreshing(false);
                }
              }}
              disabled={loading || refreshing}
              title="最新の状態に更新（他の管理者の変更を反映）"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => setSettingsModalOpen(true)}
              title="シフト提出の設定（締切・便）"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(canWrite || canLoan) && (
          <div className="mb-2 flex items-center gap-2 text-[11px] md:text-xs text-slate-500">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                autoSaving > 0 ? "bg-amber-400 animate-pulse" : "bg-emerald-500"
              }`}
            />
            {autoSaving > 0 ? "自動保存中…" : "変更は自動保存されます"}
          </div>
        )}

        </div>

        {/* スマホ: 日付ナビと絞り込みタブだけを固定する
            （下までスクロールしても「何日を見ているか」が常に分かる） */}
        {!loading && activeMobileDate && (() => {
          const date = activeMobileDate;
          const idx = displayDates.indexOf(date);
          const rows = getDayRows(date);
          const workingCount = rows.filter((r) => r.placements.length > 0).length;
          const unassignedCount = rows.length - workingCount;
          const count = workingCountByDate.get(date) ?? 0;
          const isToday = date === today;
          return (
            <div
              className="md:hidden sticky z-30 -mx-3 px-3 bg-slate-50 pt-1 pb-2 space-y-2 border-b border-slate-200/80"
              style={{ top: "var(--admin-header-h, 0px)" }}
            >
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5">
                <button
                  type="button"
                  disabled={idx <= 0}
                  onClick={() => setMobileDate(displayDates[idx - 1])}
                  className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 bg-white text-slate-600 active:bg-slate-100 disabled:opacity-30"
                  aria-label="前の日"
                >
                  <FontAwesomeIcon icon={faChevronLeft} className="h-4 w-4" />
                </button>
                <div className="min-w-0 text-center">
                  <p className={cn("text-sm font-bold", isToday ? "text-amber-600" : "text-slate-900")}>
                    {formatDate(date)}
                    {isToday && <span className="ml-1 text-[10px]">今日</span>}
                  </p>
                  <p className="text-[11px] text-slate-500">稼働 {count}人</p>
                </div>
                <button
                  type="button"
                  disabled={idx >= displayDates.length - 1}
                  onClick={() => setMobileDate(displayDates[idx + 1])}
                  className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 bg-white text-slate-600 active:bg-slate-100 disabled:opacity-30"
                  aria-label="次の日"
                >
                  <FontAwesomeIcon icon={faChevronRight} className="h-4 w-4" />
                </button>
              </div>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden bg-white">
                {(
                  [
                    ["all", "全員", rows.length],
                    ["working", "稼働", workingCount],
                    ["unassigned", "未割当", unassignedCount],
                  ] as const
                ).map(([key, label, n], i) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMobileFilter(key)}
                    className={cn(
                      "flex-1 px-2 py-1.5 text-[13px] font-medium transition-colors",
                      i > 0 && "border-l border-slate-300",
                      mobileFilter === key ? "bg-slate-800 text-white" : "text-slate-600",
                    )}
                  >
                    {label}
                    <span className="ml-1 text-[11px] tabular-nums opacity-70">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {loading ? (
          // スマホは日別リスト（氏名＋コース/車両チップ）、PC は月グリッドと表示形が違うため
          // スケルトンも実表示と同じ分岐で出す。
          <div className="space-y-3">
            {/* スマホ: 日別リスト */}
            <div className="md:hidden space-y-2">
              <Skeleton className="h-9 w-full rounded-lg" />
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <Skeleton className="h-4 w-16 shrink-0" />
                    <div className="flex min-w-0 flex-1 gap-1">
                      <Skeleton className="h-5 w-24 rounded" />
                      <Skeleton className="h-5 w-16 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* PC: 月グリッド */}
            <div className="hidden md:block space-y-3">
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
                            <Skeleton className="h-[3.25rem] w-full rounded-lg" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* スマホ: 日別ビュー。前後日を左右に並べ、スワイプで捲るように移動する
                （前後日のデータは期間ぶんまとめて取得済みなので追加のリクエストは不要） */}
            <div className="md:hidden overflow-hidden" style={{ touchAction: "pan-y" }}>
              <div
                ref={trackRef}
                // 幅は 100% のまま子を溢れさせる（translateX の % は自身の幅基準のため、
                // ここを 300% にすると 1画面ぶんのつもりが 3画面ぶんずれてしまう）
                className="flex"
                style={{ transform: "translateX(-100%)" }}
                onTransitionEnd={() => {
                  const dir = pendingDirRef.current;
                  if (!dir || !activeMobileDate) return;
                  pendingDirRef.current = 0;
                  const i = displayDates.indexOf(activeMobileDate);
                  const target = displayDates[i + dir];
                  if (target) setMobileDate(target); // 中央への戻しは useLayoutEffect が行う
                }}
                onTouchStart={(e) => {
                  if (pendingDirRef.current) return; // 収束アニメ中は受け付けない
                  const t = e.touches[0];
                  swipeRef.current = { x: t.clientX, y: t.clientY, axis: "?", dx: 0 };
                }}
                onTouchMove={(e) => {
                  const st = swipeRef.current;
                  if (!st || !activeMobileDate) return;
                  const t = e.touches[0];
                  const dx = t.clientX - st.x;
                  const dy = t.clientY - st.y;
                  if (st.axis === "?") {
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                    st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
                  }
                  if (st.axis !== "x") return;
                  const i = displayDates.indexOf(activeMobileDate);
                  const hasPrev = i > 0;
                  const hasNext = i < displayDates.length - 1;
                  // 端では引っ張り抵抗をかけて「これ以上ない」ことを示す
                  const limited = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext) ? dx / 4 : dx;
                  st.dx = limited; // 判定は必ずこの値を使う（transform 文字列はブラウザが正規化する）
                  setTrackOffset(limited, false);
                }}
                onTouchEnd={() => {
                  const st = swipeRef.current;
                  swipeRef.current = null;
                  if (!st || st.axis !== "x" || !activeMobileDate) return;
                  const moved = st.dx;
                  const i = displayDates.indexOf(activeMobileDate);
                  const goNext = moved <= -56 && i < displayDates.length - 1;
                  const goPrev = moved >= 56 && i > 0;
                  if (goNext || goPrev) {
                    pendingDirRef.current = goNext ? 1 : -1;
                    const el2 = trackRef.current;
                    if (el2) {
                      el2.style.transition = "transform 220ms cubic-bezier(0.22,1,0.36,1)";
                      el2.style.transform = goNext ? "translateX(-200%)" : "translateX(0%)";
                    }
                  } else {
                    setTrackOffset(null, true); // 元の日へ戻す
                  }
                }}
              >
                {(() => {
                  const date = activeMobileDate;
                  if (!date) return null;
                  const i = displayDates.indexOf(date);
                  const prevDate = i > 0 ? displayDates[i - 1] : null;
                  const nextDate = i < displayDates.length - 1 ? displayDates[i + 1] : null;
                  const panel = (d: string | null, key: string) => (
                    <div key={key} className="w-full shrink-0 px-0.5">
                      {d ? renderDayList(d) : null}
                    </div>
                  );
                  return (
                    <>
                      {panel(prevDate, "prev")}
                      {panel(date, "cur")}
                      {panel(nextDate, "next")}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* PC: 従来のグリッド（軸切替つき） */}
            <div className="hidden md:block space-y-6">
            {viewAxis === "course" ? (
              /* コース軸ビュー（A3）: 行=コース・セル=割当ドライバー。定員割れセルをアンバー強調 */
              <div
                ref={gridScrollRef}
                className="bg-white rounded-lg border border-slate-200/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-auto max-h-[calc(100vh-260px)] table-scroll"
              >
                <table onMouseLeave={() => cursors.reportCell(null)} className="w-full text-sm min-w-[720px] border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-slate-50/95">
                      <th className="sticky left-0 top-0 z-30 py-2.5 px-3 text-left font-medium text-slate-600 min-w-[9rem] bg-slate-50/95 border-r border-b border-slate-200/95 align-bottom">
                        <span className="block text-[10px] font-normal text-slate-400 leading-none">上段＝稼働人数</span>
                        コース
                      </th>
                      {displayDates.map((date) => {
                        const tone = shiftDayTone(date, today);
                        const count = workingCountByDate.get(date) ?? 0;
                        const isToday = date.trim() === today;
                        return (
                          <th
                            key={date}
                            data-today={isToday || undefined}
                            className={cn(
                              `${SHIFT_COL_WIDTH_CLASS} sticky top-0 z-20 border-l border-b border-slate-200/90 px-1 py-2 text-center font-medium overflow-hidden align-top bg-slate-50/95 ${tone.header}`,
                              isToday && TODAY_RULE_TOP,
                            )}
                          >
                            <span
                              className={`block leading-none mb-1 text-[11px] font-bold tabular-nums ${count > 0 ? "text-slate-700" : "text-slate-300"}`}
                              title={`稼働 ${count} 人`}
                            >
                              稼働 {count}
                            </span>
                            <span className="line-clamp-2 leading-tight break-words" title={formatDate(date)}>
                              {formatDate(date)}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((course, courseIdx) => {
                      const maxSlots = Math.max(1, course.max_drivers ?? 1);
                      const isLastCourse = courseIdx === courses.length - 1;
                      return (
                        <tr key={course.id}>
                          <td
                            className={cn(
                              "sticky left-0 z-10 bg-white py-2 px-3 align-middle border-r border-slate-200/95",
                              !isLastCourse && "border-b-2 border-slate-300",
                            )}
                          >
                            <span
                              title={courseAbbrevTooltip(course)}
                              className="inline-flex h-6 max-w-full items-center truncate rounded-[6px] px-2 text-[11px] font-semibold text-slate-900"
                              style={courseCellSurface(course.color)}
                            >
                              {courseShiftLabel(course)}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-slate-400">
                              {slotLabelById(course.slot_id) ? `${slotLabelById(course.slot_id)}・` : ""}
                              定員{maxSlots}
                            </span>
                          </td>
                          {displayDates.map((date) => {
                            const tone = shiftDayTone(date, today);
                            const isToday = date.trim() === today;
                            const assigned: { driverId: string; slot: number }[] = [];
                            for (let s = 1; s <= maxSlots; s++) {
                              const did = getCurrentDriverId(date, course.id, s);
                              if (did) assigned.push({ driverId: did, slot: s });
                            }
                            const open = maxSlots - assigned.length;
                            return (
                              <td
                                key={`${course.id}-${date}`}
                                onMouseEnter={() => cursors.reportCell(`c:${course.id}:${date}`)}
                                className={cn(
                                  `relative ${SHIFT_COL_WIDTH_CLASS} border-l border-slate-200/90 px-1 py-1 align-top ${tone.body}`,
                                  !isLastCourse && "border-b-2 border-slate-300",
                                  isToday && TODAY_RULE_SIDES,
                                )}
                              >
                                <CellPeersBadge peers={cursors.cellPeers[`c:${course.id}:${date}`]} />
                                <button
                                  type="button"
                                  onClick={() => setCourseCellModal({ courseId: course.id, date })}
                                  title="クリックして割当を確認・変更"
                                  className="flex min-h-[3.25rem] w-full flex-col gap-1 rounded-lg px-1.5 py-1.5 text-left transition-colors cursor-pointer hover:bg-white/70"
                                >
                                  {assigned.map((a) => {
                                    const d = drivers.find((x) => x.id === a.driverId);
                                    return (
                                      <span
                                        key={a.slot}
                                        className="flex h-6 w-full min-w-0 items-center truncate rounded-[6px] bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-800"
                                      >
                                        {d ? getDisplayName(d) : "（不明）"}
                                      </span>
                                    );
                                  })}
                                  {open > 0 && (
                                    <span className="flex flex-1 items-center justify-center text-[10px] font-medium text-slate-300">
                                      {assigned.length === 0 ? "＋" : `空${open}`}
                                    </span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
            <div
              ref={gridScrollRef}
              className="bg-white rounded-lg border border-slate-200/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-auto max-h-[calc(100vh-260px)] table-scroll"
            >
              <table onMouseLeave={() => cursors.reportCell(null)} className="w-full text-sm min-w-[720px] border-separate border-spacing-0">
                <thead>
                  <tr className="bg-slate-50/95">
                    <th className="sticky left-0 top-0 z-30 py-2.5 px-3 text-left font-medium text-slate-600 min-w-[9rem] bg-slate-50/95 border-r border-b border-slate-200/95 align-bottom">
                      <span className="block text-[10px] font-normal text-slate-400 leading-none">上段＝稼働人数</span>
                      ドライバー
                    </th>
                    {displayDates.map((date) => {
                      const tone = shiftDayTone(date, today);
                      const count = workingCountByDate.get(date) ?? 0;
                      const isToday = date.trim() === today;
                      return (
                        <th
                          key={date}
                          data-today={isToday || undefined}
                          className={cn(
                            `${SHIFT_COL_WIDTH_CLASS} sticky top-0 z-20 border-l border-b border-slate-200/90 px-1 py-2 text-center font-medium overflow-hidden align-top bg-slate-50/95 ${tone.header}`,
                            isToday && TODAY_RULE_TOP,
                          )}
                        >
                          <span
                            className={`block leading-none mb-1 text-[11px] font-bold tabular-nums ${count > 0 ? "text-slate-700" : "text-slate-300"}`}
                            title={`稼働 ${count} 人`}
                          >
                            稼働 {count}
                          </span>
                          <span className="line-clamp-2 leading-tight break-words" title={formatDate(date)}>
                            {formatDate(date)}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {driversWithCourses.map((driver, driverIdx) => {
                    const isLastDriver = driverIdx === driversWithCourses.length - 1;
                    return (
                      <tr key={driver.id}>
                        <td
                          className={cn(
                            "sticky left-0 z-10 bg-white py-2 px-3 align-middle border-r border-slate-200/95",
                            !isLastDriver && "border-b-2 border-slate-300",
                          )}
                        >
                          <span className="font-medium text-slate-800">{getDisplayName(driver)}</span>
                        </td>
                        {displayDates.map((date) => {
                          const tone = shiftDayTone(date, today);
                          const off = isDriverOffDay(driver.id, date);
                          // 便指定の休み希望（全休でない場合のみ。割当はブロックせず注記表示）。
                          const slotOffs = off ? [] : getDriverSlotOffNames(driver.id, date);
                          const placements = findDriverPlacementsOnDate(localShifts, date, driver.id);
                          const assignedCourses = placements
                            .map((p) => courses.find((c) => c.id === p.courseId))
                            .filter((c): c is Course => Boolean(c))
                            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                          const hasAny = placements.length > 0;
                          // 車両は「1日1台」前提。代表 placement（先頭コース）で読み書きする
                          const placement = placements[0] ?? null;
                          const dirty = isDateDriverDirty(date, driver.id);

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
                          const currentExternal = getCurrentExternalForDriverOnDate(date, driver.id);
                          const hoverVehiclePlate: VehiclePlateData | null = (() => {
                            if (!currentVid) return null;
                            const fromFleet = fleetById.get(currentVid);
                            if (fromFleet) return fromFleet;
                            const embedded =
                              prow?.vehicle_id === currentVid ? normalizeShiftVehiclesEmbed(prow).vehicles : null;
                            if (embedded) return embedded;
                            return { id: currentVid };
                          })();

                          const vehicleTitle =
                            hoverVehiclePlate && currentVid ? formatPlateOneLine(hoverVehiclePlate) : undefined;

                          const isEditing =
                            editingCell?.date === date && editingCell?.driverId === driver.id;
                          const isToday = date.trim() === today;
                          // セル単位の操作可否（A1）: シフト編集者は常に、
                          // 配車のみの担当は割当済みセル（車両を選べる）だけ開ける。
                          const canOpenCell = canWrite || (canDispatch && hasAny);

                          // D&D コピーのドロップ予告ハイライト（横フィルは範囲、別ドライバーは単セル）
                          const inDropPreview = (() => {
                            if (!dragSource || !dragOverCell) return false;
                            if (dragOverCell.driverId !== driver.id) return false;
                            if (dragSource.driverId === driver.id) {
                              const si = displayDates.indexOf(dragSource.date);
                              const ti = displayDates.indexOf(dragOverCell.date);
                              const di = displayDates.indexOf(date);
                              if (si < 0 || ti < 0 || di < 0) return false;
                              const [a, b] = si < ti ? [si, ti] : [ti, si];
                              return di >= a && di <= b && date !== dragSource.date;
                            }
                            return dragOverCell.date === date;
                          })();

                          return (
                            <td
                              key={`${driver.id}-${date}`}
                              onMouseEnter={() => cursors.reportCell(`d:${driver.id}:${date}`)}
                              onDragOver={(e) => {
                                if (!isValidDropTarget(date, driver.id)) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "copy";
                                if (dragOverCell?.date !== date || dragOverCell?.driverId !== driver.id) {
                                  setDragOverCell({ date, driverId: driver.id });
                                }
                              }}
                              onDrop={(e) => {
                                if (!isValidDropTarget(date, driver.id)) return;
                                e.preventDefault();
                                handleCellDrop(date, driver.id);
                              }}
                              className={cn(
                                `relative ${SHIFT_COL_WIDTH_CLASS} border-l border-slate-200/90 px-1 py-1`,
                                !isLastDriver && "border-b-2 border-slate-300",
                                off ? "align-middle bg-amber-50" : `align-top ${tone.body}`,
                                isToday && TODAY_RULE_SIDES,
                                inDropPreview && "bg-sky-50 ring-2 ring-inset ring-sky-400",
                              )}
                            >
                              <CellPeersBadge peers={cursors.cellPeers[`d:${driver.id}:${date}`]} />
                              {off ? (
                                <button
                                  type="button"
                                  disabled={!canWrite}
                                  onClick={() => openOffModal(driver.id, date)}
                                  title={canWrite ? "クリックして希望休を確認・解除" : undefined}
                                  className={cn(
                                    "flex min-h-[3.25rem] w-full items-center justify-center rounded-lg transition-colors",
                                    canWrite ? "cursor-pointer hover:bg-amber-100" : "cursor-default",
                                  )}
                                >
                                  <span className="text-[12px] font-semibold text-amber-900">希望休</span>
                                </button>
                              ) : (
                                // 閲覧: 結果だけを静的表示。クリックで中央の編集モーダルが開く
                                    <button
                                      type="button"
                                      disabled={!canOpenCell}
                                      onClick={() => setEditingCell({ date, driverId: driver.id })}
                                      draggable={canWrite && hasAny}
                                      onDragStart={(e) => {
                                        if (!canWrite || !hasAny) return;
                                        e.dataTransfer.setData("text/plain", "shift-copy");
                                        e.dataTransfer.effectAllowed = "copy";
                                        setDragSource({
                                          date,
                                          driverId: driver.id,
                                          courseIds: [...new Set(placements.map((p) => p.courseId))],
                                        });
                                      }}
                                      onDragEnd={() => {
                                        setDragSource(null);
                                        setDragOverCell(null);
                                      }}
                                      title={
                                        canOpenCell
                                          ? canWrite && hasAny
                                            ? "クリックして編集／ドラッグでコピー"
                                            : "クリックして編集"
                                          : vehicleTitle
                                      }
                                      className={cn(
                                        "group flex min-h-[3.25rem] w-full flex-col gap-1 rounded-lg px-1.5 py-1.5 text-left transition-colors",
                                        canOpenCell && !isEditing && "hover:bg-white/70",
                                        canOpenCell ? "cursor-pointer" : "cursor-default",
                                        isEditing && "bg-white ring-2 ring-slate-400",
                                        dirty && !isEditing && "ring-2 ring-amber-400",
                                      )}
                                    >
                                      {slotOffs.length > 0 && (
                                        <span
                                          role={canWrite ? "button" : undefined}
                                          tabIndex={canWrite ? 0 : undefined}
                                          onClick={
                                            canWrite
                                              ? (e) => {
                                                  e.stopPropagation();
                                                  openOffModal(driver.id, date);
                                                }
                                              : undefined
                                          }
                                          className="w-full truncate rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-amber-800 hover:bg-amber-200"
                                          title={`${slotOffs.join("・")} 休み希望（クリックで確認・解除）`}
                                        >
                                          {slotOffs.join("・")}休み希望
                                        </span>
                                      )}
                                      {/* 単発案件（このドライバーが参加する日）。コースと同格の「仕事」として表示 */}
                                      {(spotJobsByDriverDate.get(`${date}:${driver.id}`) ?? []).map((job) => (
                                        <span
                                          key={job.id}
                                          title={`単発案件「${job.title}」${job.meetingTime ? `（集合 ${job.meetingTime}）` : ""}`}
                                          className="w-full truncate rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-sky-800"
                                        >
                                          {job.title}
                                        </span>
                                      ))}
                                      {hasAny ? (
                                        <>
                                          {assignedCourses.map((course) => (
                                            <span
                                              key={course.id}
                                              title={courseAbbrevTooltip(course)}
                                              className="flex h-6 w-full min-w-0 items-center overflow-hidden rounded-[6px] px-1.5"
                                              style={courseCellSurface(course.color)}
                                            >
                                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight text-slate-900">
                                                {courseShiftLabel(course)}
                                              </span>
                                              {slotLabelById(course.slot_id) && (
                                                <span className="ml-1 shrink-0 text-[9px] font-medium leading-tight text-slate-600">
                                                  {slotLabelById(course.slot_id)}
                                                </span>
                                              )}
                                            </span>
                                          ))}
                                          {density === "detail" &&
                                            (() => {
                                              // 実効集合時刻（シフト上書き ?? コース標準）をコース順に併記
                                              const times = placements
                                                .map((p) => {
                                                  const c = courses.find((cc) => cc.id === p.courseId);
                                                  if (!c) return null;
                                                  const r = shifts.find(
                                                    (s) =>
                                                      s.shift_date === date &&
                                                      s.course_id === p.courseId &&
                                                      s.slot === p.slot,
                                                  );
                                                  return toTimeInputValue(r?.meeting_time ?? c.meeting_time) || null;
                                                })
                                                .filter((t): t is string => Boolean(t));
                                              if (times.length === 0) return null;
                                              return (
                                                <span className="w-full text-center text-[9px] font-medium leading-none text-slate-500">
                                                  集合 {times.join(" / ")}
                                                </span>
                                              );
                                            })()}
                                          {density !== "compact" && (
                                            <span className="mt-0.5 flex w-full min-w-0 items-center justify-center">
                                              {currentVid && hoverVehiclePlate ? (
                                                <VehiclePlate
                                                  vehicle={hoverVehiclePlate}
                                                  compact
                                                  className="!max-w-none w-full min-w-0 pointer-events-none"
                                                />
                                              ) : currentExternal ? (
                                                <span className="py-0.5 text-[10px] font-semibold text-amber-600">他社車両</span>
                                              ) : (
                                                <span className="py-0.5 text-[10px] font-medium text-slate-400">車両なし</span>
                                              )}
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        <span className="flex flex-1 items-center justify-center text-base text-slate-300 group-hover:text-slate-400">
                                          {canWrite ? "＋" : "—"}
                                        </span>
                                      )}
                                    </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50/93">
                    <td className="sticky left-0 z-10 py-2 px-3 text-xs font-medium text-slate-600 bg-slate-50 border-r border-t border-slate-200/95">
                      <span className="block text-[10px] font-normal text-slate-400 leading-none">タップで一覧</span>
                      未割当
                    </td>
                    {displayDates.map((date) => {
                      const unassigned = getUnassignedDriversOnDate(date);
                      const tone = shiftDayTone(date, today);
                      const isOpen = unassignedOpenDate === date;
                      const isToday = date.trim() === today;
                      if (unassigned.length === 0) {
                        return (
                          <td
                            key={`off-${date}`}
                            className={cn(
                              `${SHIFT_COL_WIDTH_CLASS} border-l border-t border-slate-200/90 px-1 py-2 text-center text-[11px] text-slate-400 align-middle ${tone.body}`,
                              isToday && TODAY_RULE_BOTTOM,
                            )}
                          >
                            —
                          </td>
                        );
                      }
                      return (
                        <td
                          key={`off-${date}`}
                          className={cn(
                            `${SHIFT_COL_WIDTH_CLASS} border-l border-t border-slate-200/90 px-0.5 py-0.5 align-top ${tone.body}`,
                            isToday && TODAY_RULE_BOTTOM,
                          )}
                        >
                          {/* 閲覧: 人数のみ。クリックで中央モーダル（全員＋その場割当） */}
                          <button
                            type="button"
                            onClick={() => setUnassignedOpenDate(date)}
                            className={cn(
                              "flex min-h-[2.25rem] w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-center transition-colors",
                              "cursor-pointer hover:bg-white/70 hover:ring-1 hover:ring-slate-300",
                              isOpen && "bg-white ring-2 ring-slate-400",
                            )}
                            title="未割当ドライバーの一覧"
                          >
                            <span className="text-[13px] font-bold tabular-nums text-slate-700 leading-none">
                              {unassigned.length}
                            </span>
                            <span className="line-clamp-1 break-all text-[10px] text-slate-500 leading-tight">
                              {getDisplayName(unassigned[0])}
                              {unassigned.length > 1 ? ` 他${unassigned.length - 1}` : ""}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {/* 単発案件（期間内にあるときだけ行を出す）。ゲスト・名前だけの参加者も
                      ここで全件見える（ドライバー行のチップは登録メンバー分のみ） */}
                  {spotJobs.length > 0 && (
                    <tr className="bg-slate-50/93">
                      <td className="sticky left-0 z-10 py-2 px-3 text-xs font-medium text-slate-600 bg-slate-50 border-r border-t border-slate-200/95">
                        <span className="block text-[10px] font-normal text-slate-400 leading-none">タップで一覧へ</span>
                        単発案件
                      </td>
                      {displayDates.map((date) => {
                        const dayJobs = spotJobsByDate.get(date) ?? [];
                        const tone = shiftDayTone(date, today);
                        const isToday = date.trim() === today;
                        if (dayJobs.length === 0) {
                          return (
                            <td
                              key={`spot-${date}`}
                              className={cn(
                                `${SHIFT_COL_WIDTH_CLASS} border-l border-t border-slate-200/90 px-1 py-2 text-center text-[11px] text-slate-400 align-middle ${tone.body}`,
                                isToday && TODAY_RULE_BOTTOM,
                              )}
                            >
                              —
                            </td>
                          );
                        }
                        return (
                          <td
                            key={`spot-${date}`}
                            className={cn(
                              `${SHIFT_COL_WIDTH_CLASS} border-l border-t border-slate-200/90 px-0.5 py-0.5 align-top ${tone.body}`,
                              isToday && TODAY_RULE_BOTTOM,
                            )}
                          >
                            <a
                              href="/admin/spot-jobs"
                              className="flex min-h-[2.25rem] w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-center transition-colors hover:bg-white/70 hover:ring-1 hover:ring-slate-300"
                              title="単発案件の一覧へ"
                            >
                              {dayJobs.map((job) => (
                                <span
                                  key={job.id}
                                  className="w-full truncate rounded bg-sky-100 px-1 py-0.5 text-[10px] font-semibold leading-tight text-sky-800"
                                >
                                  {job.title}
                                </span>
                              ))}
                            </a>
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
            </div>

            {/* 希望休の一覧/解除は上のグリッドのセルクリック（管理モーダル）に集約。下部の一覧は廃止。 */}

            {/* 車両の貸出中（日毎）— 運用で触る頻度が高いため凡例より上に配置 */}
            <CollapsibleSection
              title="車両の貸出中（日毎）"
              hint={`この期間 ${vehicleLoans.filter((l) => displayDates.includes(l.loan_date)).length} 件`}
            >
              <p className="text-[11px] text-slate-500 mb-3">
                貸出中にした日は、その車両をシフトに紐付けできません（「貸」=貸出中）。
                セルをタップで切替、押しながらなぞると複数日をまとめて設定できます。
              </p>
              <div className="overflow-x-auto table-scroll">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left min-w-[7.5rem] border-r border-b border-slate-200/95 font-medium text-slate-600">
                        車両
                      </th>
                      {displayDates.map((date) => {
                        const tone = shiftDayTone(date, today);
                        const dd = Number(date.split("-")[2]);
                        return (
                          <th key={date} className={`w-10 min-w-10 px-0.5 py-1.5 text-center font-medium border-b border-slate-200/95 ${tone.header}`}>
                            {dd}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {[...fleetVehicles]
                      .sort((a, b) => formatPlateOneLine(a).localeCompare(formatPlateOneLine(b), "ja"))
                      .map((v) => (
                      <tr key={v.id} className="border-t border-slate-100">
                        <td className="sticky left-0 z-10 bg-white px-2 py-1 border-r border-slate-200/95">
                          <VehiclePlate vehicle={v} compact className="max-w-[7rem] pointer-events-none" />
                        </td>
                        {displayDates.map((date) => {
                          const on = isVehicleLoaned(v.id, date);
                          return (
                            <td key={date} className="px-0.5 py-0.5 text-center">
                              <button
                                type="button"
                                disabled={!canLoan}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  startLoanPaint(v.id, date);
                                }}
                                onMouseEnter={() => applyLoanPaint(v.id, date)}
                                title={on ? "貸出中（タップで解除・なぞって一括）" : "タップで貸出中に（なぞって一括）"}
                                className={cn(
                                  "w-9 h-9 rounded-md border text-[11px] font-semibold transition-colors disabled:opacity-50 select-none",
                                  on
                                    ? "bg-amber-600 border-amber-600 text-white"
                                    : "border-slate-200 bg-white text-slate-300 hover:border-slate-300",
                                )}
                              >
                                {on ? "貸" : ""}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="凡例・表の見かた">
              <div className="flex flex-wrap gap-6 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-6 rounded border border-slate-200 bg-slate-50" />
                  <span>コース未登録のドライバーはこの表に含まれません</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-6 rounded border border-dashed border-slate-200 bg-white" />
                  <span>未割当のセル（＋）。タップで割当できます</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-6 rounded border border-slate-300 bg-gradient-to-br from-slate-100 to-slate-200" />
                  <span>割当済（コース色＝そのコース。略記／正式名は編集パネルと同じ）</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-6 rounded border border-amber-400 bg-amber-50" />
                  <span>未保存の変更</span>
                </div>
                <div className="flex items-center gap-1.5 basis-full md:basis-auto">
                  <span className="text-slate-500">
                    車両は紐づけ一覧を優先表示し、「その他の車両」からマスタ上のその他の車両も選べます。
                  </span>
                </div>
                <div className="flex items-center gap-1.5 basis-full">
                  <span className="text-slate-500">
                    割当済みセルはドラッグでコピーできます（同じ行＝離した日まで連日コピー／別ドライバーの行＝その日へコピー。
                    希望休・担当外・定員満の日は自動でスキップ。車両はコピーされません）。
                    「コース軸」に切り替えると、行=コースで埋まり具合を確認できます。
                    スマホでは1日ずつの日別ビューになります（ドラッグや軸・密度の切替はPC向けの機能です）。
                  </span>
                </div>
              </div>
            </CollapsibleSection>
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
                                  // html2canvas は大きい line-height だと文字を下寄りに描くため、
                                  // line-height は小さくし、上下 padding で中央に寄せる（padding は正しく描ける）。
                                  padding: "7px 6px",
                                  marginTop: ci === 0 ? 0 : `${EX_CELL_GAP}px`,
                                  height: `${EX_COURSE_H}px`,
                                  lineHeight: "18px",
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
                                // 上記と同じ理由（html2canvas の縦位置対策）。
                                padding: "4px 0",
                                lineHeight: "12px",
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
      {/* 希望休 管理モーダル（セルクリックで開く。その日の希望休一覧＋削除＋変更履歴） */}
      {offModal && (() => {
        const driver = drivers.find((d) => d.id === offModal.driverId);
        const dayReqs = requests.filter(
          (r) => r.driver_id === offModal.driverId && r.request_date === offModal.date,
        );
        const summary = summarizeHistory(offHistory ?? []);
        const fmtDateTime = (iso: string) => {
          const d = new Date(iso);
          return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        };
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setOffModal(null)}
          >
            <div
              className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {driver ? getDisplayName(driver) : "ドライバー"} の希望休
                </h3>
                <span className="shrink-0 text-xs text-slate-500">{formatDate(offModal.date)}</span>
              </div>

              {/* その日の希望休（全休＋便）一覧と個別解除 */}
              {dayReqs.length === 0 ? (
                <p className="py-3 text-sm text-slate-400">この日の希望休はありません。</p>
              ) : (
                <div className="space-y-1.5">
                  {dayReqs.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <span className="text-sm text-slate-700">{slotName(r.slot_id)}</span>
                      {canWrite && driver && (
                        <button
                          type="button"
                          onClick={() => deleteOffRequest(driver, r)}
                          className="text-xs font-medium text-rose-500 hover:text-rose-700"
                        >
                          解除
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 変更履歴（最小表示：初回提出 / 最終変更） */}
              <div className="mt-3 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                {offHistoryLoading ? (
                  <p>履歴を読み込み中…</p>
                ) : !offHistory || offHistory.length === 0 ? (
                  <p>変更履歴はまだありません。</p>
                ) : (
                  <div className="space-y-0.5">
                    {summary.firstSubmittedAt && (
                      <p>初回提出: {fmtDateTime(summary.firstSubmittedAt)}</p>
                    )}
                    {summary.lastChangedAt && (
                      <p>
                        最終変更: {fmtDateTime(summary.lastChangedAt)}
                        {summary.lastActorName ? `（${summary.lastActorName}` : ""}
                        {summary.lastActorName
                          ? summary.lastActorType === "admin"
                            ? "・運営）"
                            : "・本人）"
                          : ""}
                      </p>
                    )}
                    {summary.changed && (
                      <p className="text-amber-600">※ 初回提出から変更されています</p>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOffModal(null)}
                className="mt-4 w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white"
              >
                閉じる
              </button>
            </div>
          </div>
        );
      })()}

      {/* コース×日モーダル（コース軸ビューのセルクリックで開く。割当ドライバーの確認・追加・解除） */}
      {courseCellModal && (() => {
        const { courseId, date } = courseCellModal;
        const course = courses.find((c) => c.id === courseId);
        if (!course) return null;
        const maxSlots = Math.max(1, course.max_drivers ?? 1);
        const assigned: { driverId: string; slot: number }[] = [];
        for (let s = 1; s <= maxSlots; s++) {
          const did = getCurrentDriverId(date, courseId, s);
          if (did) assigned.push({ driverId: did, slot: s });
        }
        const open = maxSlots - assigned.length;
        const assignedIds = new Set(assigned.map((a) => a.driverId));
        // 追加候補: このコースを担当可能・未割当（このコースに）・全休でない
        const candidates = driversWithCourses.filter(
          (d) =>
            getDriverCourseIds(d).includes(courseId) &&
            !assignedIds.has(d.id) &&
            !isDriverOffDay(d.id, date),
        );
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setCourseCellModal(null)}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-xl bg-white shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-4 py-3">
                <span
                  title={courseAbbrevTooltip(course)}
                  className="inline-flex h-7 max-w-[60%] items-center truncate rounded-[6px] px-2.5 text-[13px] font-semibold text-slate-900"
                  style={courseCellSurface(course.color)}
                >
                  {courseShiftLabel(course)}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{formatDate(date)}</span>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    割当済み（定員{maxSlots}・空き{open}）
                  </p>
                  {assigned.length === 0 ? (
                    <p className="text-xs text-slate-400">まだ誰も入っていません。</p>
                  ) : (
                    assigned.map((a) => {
                      const d = drivers.find((x) => x.id === a.driverId);
                      return (
                        <div
                          key={a.slot}
                          className="flex h-9 items-center justify-between rounded-lg border border-slate-200/90 px-3"
                        >
                          <span className="truncate text-[13px] font-medium text-slate-800">
                            {d ? getDisplayName(d) : "（不明）"}
                          </span>
                          {canWrite && d && (
                            <button
                              type="button"
                              onClick={() => removeDriverFromCourseOnDate(date, d.id, courseId)}
                              className="shrink-0 text-xs font-medium text-rose-500 hover:text-rose-700"
                            >
                              外す
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {canWrite && open > 0 ? (
                  <div className="space-y-1.5 border-t border-slate-200/70 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      追加できるドライバー
                    </p>
                    {candidates.length === 0 ? (
                      <p className="text-xs text-slate-400">
                        追加できるドライバーがいません（担当可能・希望休なしが対象）。
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {candidates.map((d) => {
                          const busy = findDriverPlacementsOnDate(localShifts, date, d.id).length > 0;
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => addDriverToCourseOnDate(date, d.id, courseId)}
                              title={busy ? "この日は他コースにも割当があります" : undefined}
                              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100"
                            >
                              ＋{getDisplayName(d)}
                              {busy && <span className="text-[9px] text-amber-600">他コースあり</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/80 px-4 py-3">
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      autoSaving > 0 ? "bg-amber-400 animate-pulse" : "bg-emerald-500",
                    )}
                  />
                  {autoSaving > 0 ? "保存中…" : "✓ 保存済み"}
                </span>
                <button
                  type="button"
                  onClick={() => setCourseCellModal(null)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-900"
                >
                  完了
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 未割当ドライバーモーダル（未割当行のクリックで開く。一覧＋その場割当） */}
      {unassignedOpenDate && (() => {
        const date = unassignedOpenDate;
        const unassigned = getUnassignedDriversOnDate(date);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setUnassignedOpenDate(null)}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-xl bg-white shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200/70 px-4 py-3">
                <span className="text-sm font-semibold text-slate-800">未割当 {unassigned.length}人</span>
                <span className="shrink-0 text-xs text-slate-500">{formatDate(date)}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
                {unassigned.length === 0 ? (
                  <p className="py-2 text-sm text-slate-400">この日の未割当ドライバーはいません。</p>
                ) : (
                  unassigned.map((d) => {
                    const addable = getAddableCoursesForDriverOnDate(date, d.id);
                    return (
                      <div key={d.id} className="rounded-lg border border-slate-200/90 px-3 py-2">
                        <span className="text-[13px] font-medium text-slate-800">{getDisplayName(d)}</span>
                        {canWrite ? (
                          addable.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {addable.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => addDriverToCourseOnDate(date, d.id, c.id)}
                                  className="inline-flex items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100"
                                  title={`${getDisplayName(d)} を ${courseShiftLabel(c)} に割り当て`}
                                >
                                  ＋{courseShiftLabel(c)}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="ml-1 text-[11px] text-slate-400">空きコースなし</span>
                          )
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex justify-end border-t border-slate-200/80 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setUnassignedOpenDate(null)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-900"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* セル編集モーダル（セルクリックで開く。コース割当＋車両割当を中央固定で表示し、
          セル位置やリスト長に左右されない。後続の ConfirmDialog が上に重なる） */}
      {editingCell && (() => {
        const { date, driverId } = editingCell;
        const driver = drivers.find((d) => d.id === driverId);
        if (!driver) return null;
        const placements = findDriverPlacementsOnDate(localShifts, date, driverId);
        const assignedCourses = placements
          .map((p) => courses.find((c) => c.id === p.courseId))
          .filter((c): c is Course => Boolean(c))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const hasAny = placements.length > 0;
        const placement = placements[0] ?? null;
        const addable = getAddableCoursesForDriverOnDate(date, driverId);
        const prow = placement
          ? shifts.find(
              (s) =>
                s.shift_date === date &&
                s.course_id === placement.courseId &&
                s.slot === placement.slot,
            )
          : null;
        const currentVid = getCurrentVehicleForDriverOnDate(date, driverId);
        const currentExternal = getCurrentExternalForDriverOnDate(date, driverId);
        const currentPlate: VehiclePlateData | null = (() => {
          if (!currentVid) return null;
          const fromFleet = fleetById.get(currentVid);
          if (fromFleet) return fromFleet;
          const embedded =
            prow?.vehicle_id === currentVid ? normalizeShiftVehiclesEmbed(prow).vehicles : null;
          return embedded ?? { id: currentVid };
        })();
        const byPlateLine = (a: VehiclePlateData, b: VehiclePlateData) =>
          formatPlateOneLine(a).localeCompare(formatPlateOneLine(b), "ja");
        const linkedIds = new Set(
          vehicleLinks.filter((l) => l.driver_id === driverId).map((l) => l.vehicle_id),
        );
        const sortedFleet = [...fleetVehicles].sort(byPlateLine);
        const linkedPlates = sortedFleet.filter((v) => linkedIds.has(v.id));
        let otherPlates = sortedFleet.filter((v) => !linkedIds.has(v.id));
        if (currentVid && currentPlate && !sortedFleet.some((v) => v.id === currentVid)) {
          otherPlates = [currentPlate, ...otherPlates].sort(byPlateLine);
        }
        // ※選択中を先頭に寄せる並べ替えは入れない。選んだ瞬間にプレートの位置が動いて
        //   かえって分かりにくくなるため（2026-07-22 フィードバック）。
        //   「今どれが選ばれているか」は、その場のリング＋チェック＋ラベルと、
        //   セクション見出し横の現在値サマリで示す。
        // その日すでに他ドライバーが使用中の車両 id → 使用者名
        const takenByMap = (() => {
          const m = new Map<string, string>();
          const holders = vehicleHoldersByDate.get(date);
          if (holders) {
            for (const [vid, ids] of holders) {
              const other = ids.find((id) => id !== driverId);
              if (other) {
                const od = drivers.find((d) => d.id === other);
                m.set(vid, od ? getDisplayName(od) : "別のドライバー");
              }
            }
          }
          return m;
        })();
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setEditingCell(null)}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200/70 px-4 py-3">
                <span className="truncate text-sm font-semibold text-slate-800">
                  {getDisplayName(driver)}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{formatDate(date)}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {/* 横長画面はコース｜車両の2カラム、狭い画面は縦積み */}
                <div className={cn("grid gap-4", hasAny && "sm:grid-cols-2")}>
                  {/* コース */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">コース</p>
                    {assignedCourses.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        {assignedCourses.map((course) => (
                          <div
                            key={course.id}
                            title={courseAbbrevTooltip(course)}
                            className="flex h-9 items-center gap-1 rounded-lg px-2.5"
                            style={courseCellSurface(course.color)}
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">
                              {courseShiftLabel(course)}
                            </span>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => removeDriverFromCourseOnDate(date, driverId, course.id)}
                                className="shrink-0 px-1.5 text-base leading-none text-slate-500 hover:text-rose-600"
                                title="このコースを外す"
                                aria-label="このコースを外す"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">未割当</p>
                    )}
                    {canWrite && addable.length > 0 ? (() => {
                      // 「最近入ったコース」を先頭グループに（addable は実績優先で整列済み）。
                      // 片方しか無いときはラベルを出さず従来どおりの1グループ表示。
                      const usage = courseUsageByDriver.get(driverId);
                      const recent = usage ? addable.filter((c) => usage.has(c.id)) : [];
                      const others = usage ? addable.filter((c) => !usage.has(c.id)) : addable;
                      const chip = (c: Course) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => addDriverToCourseOnDate(date, driverId, c.id)}
                          className="inline-flex items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100"
                        >
                          ＋{courseShiftLabel(c)}
                        </button>
                      );
                      if (recent.length === 0 || others.length === 0) {
                        return <div className="flex flex-wrap gap-1.5 pt-0.5">{addable.map(chip)}</div>;
                      }
                      return (
                        <div className="space-y-2 pt-0.5">
                          <div>
                            <p className="mb-1 text-[10px] text-slate-400">最近入ったコース</p>
                            <div className="flex flex-wrap gap-1.5">{recent.map(chip)}</div>
                          </div>
                          <div>
                            <p className="mb-1 text-[10px] text-slate-400">その他</p>
                            <div className="flex flex-wrap gap-1.5">{others.map(chip)}</div>
                          </div>
                        </div>
                      );
                    })() : null}
                    {/* 単発案件（このドライバーがその日参加する分・読み取り専用） */}
                    {(spotJobsByDriverDate.get(`${date}:${driverId}`) ?? []).length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">単発案件</p>
                        <div className="mt-1 flex flex-col gap-1.5">
                          {(spotJobsByDriverDate.get(`${date}:${driverId}`) ?? []).map((job) => (
                            <a
                              key={job.id}
                              href="/admin/spot-jobs"
                              className="flex h-9 items-center gap-2 rounded-lg bg-sky-50 px-2.5 text-[13px] font-semibold text-sky-900 transition-colors hover:bg-sky-100"
                              title="単発案件の一覧へ"
                            >
                              <span className="min-w-0 flex-1 truncate">{job.title}</span>
                              {job.meetingTime && (
                                <span className="shrink-0 text-[11px] font-medium text-sky-700">
                                  集合 {job.meetingTime}
                                </span>
                              )}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 車両（コース割当がある時のみ選択可能） */}
                  {hasAny ? (
                    <div className="space-y-2 sm:border-l sm:border-slate-200/70 sm:pl-4">
                      {/* 現在値のサマリ。「その他の車両」は内側スクロールのため、
                          選択中がリスト外にあっても今の状態が分かるようにする。 */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">車両</p>
                        <span
                          className={cn(
                            "truncate text-[11px] font-medium",
                            currentExternal
                              ? "text-amber-600"
                              : currentPlate
                                ? "text-slate-900"
                                : "text-slate-400",
                          )}
                        >
                          {currentExternal
                            ? "他社車両"
                            : currentPlate
                              ? formatPlateOneLine(currentPlate)
                              : "車両なし"}
                        </span>
                      </div>
                      <VehicleOptionList
                        valueId={currentVid}
                        isExternal={currentExternal}
                        linkedPlates={linkedPlates}
                        otherPlates={otherPlates}
                        takenBy={takenByMap}
                        loanedIds={loanedByDate.get(date)}
                        onChange={(id) => setVehicleForDriverOnDate(date, driverId, id)}
                        onSelectExternal={() => setExternalForDriverOnDate(date, driverId, true)}
                        disabled={!canDispatch}
                      />
                    </div>
                  ) : null}
                </div>

                {/* 時間・集合場所（A2）: コースごとに実効値（個別上書き ?? コース標準）を表示・編集 */}
                {hasAny ? (
                  <div className="mt-4 space-y-2 border-t border-slate-200/70 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">時間・集合場所</p>
                    {placements.map((p) => {
                      const course = courses.find((c) => c.id === p.courseId);
                      if (!course) return null;
                      const row = shifts.find(
                        (s) => s.shift_date === date && s.course_id === p.courseId && s.slot === p.slot,
                      );
                      const overridden = Boolean(
                        row &&
                          (row.meeting_place != null ||
                            row.meeting_time != null ||
                            row.arrival_time != null ||
                            row.end_time != null),
                      );
                      const effMeeting = toTimeInputValue(row?.meeting_time ?? course.meeting_time);
                      const effArrival = toTimeInputValue(row?.arrival_time ?? course.arrival_time);
                      const effEnd = toTimeInputValue(row?.end_time ?? course.end_time);
                      const effPlace = row?.meeting_place ?? course.meeting_place ?? "";
                      return (
                        <div key={`${p.courseId}-${p.slot}`} className="space-y-2 rounded-lg border border-slate-200/80 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="inline-flex h-6 max-w-[50%] items-center truncate rounded-[6px] px-2 text-[11px] font-semibold text-slate-900"
                              style={courseCellSurface(course.color)}
                            >
                              {courseShiftLabel(course)}
                            </span>
                            {overridden ? (
                              <span className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold text-amber-600">この日だけ個別設定</span>
                                {canWrite && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      persistTimes(date, p.courseId, p.slot, {
                                        meetingPlace: null,
                                        meetingTime: null,
                                        arrivalTime: null,
                                        endTime: null,
                                      })
                                    }
                                    className="text-[11px] font-medium text-slate-500 underline hover:text-slate-800"
                                  >
                                    コース標準に戻す
                                  </button>
                                )}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">コース標準</span>
                            )}
                          </div>
                          {canWrite ? (
                            <>
                              <div className="grid grid-cols-3 gap-2">
                                {([
                                  ["集合", effMeeting, (v: string | null) => ({ meetingTime: v })],
                                  ["着車", effArrival, (v: string | null) => ({ arrivalTime: v })],
                                  ["終業", effEnd, (v: string | null) => ({ endTime: v })],
                                ] as const).map(([label, eff, mk]) => (
                                  <div key={label}>
                                    <span className="mb-0.5 block text-[10px] text-slate-500">{label}</span>
                                    <TimePicker
                                      value={eff || null}
                                      onChange={(v) => {
                                        const next = v ?? "";
                                        if (next === eff) return;
                                        persistTimes(date, p.courseId, p.slot, mk(next || null));
                                      }}
                                      placeholder="--:--"
                                      buttonClassName="h-8 px-2"
                                    />
                                  </div>
                                ))}
                              </div>
                              {/* onBlur だけの保存はパネルを閉じる（＝アンマウント）と blur が
                                  発火せず入力が消える。自動保存する入力に置き換えた（2026-08-06） */}
                              <AutoSaveTextInput
                                value={effPlace ?? ""}
                                resetKey={`${date}:${p.courseId}:${p.slot}`}
                                placeholder="集合場所（未入力=コース標準）"
                                onSave={(v) =>
                                  persistTimes(date, p.courseId, p.slot, { meetingPlace: v })
                                }
                                className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                              />
                            </>
                          ) : (
                            <p className="text-xs text-slate-600">
                              集合 {effMeeting || "—"}・着車 {effArrival || "—"}・終業 {effEnd || "—"}
                              {effPlace ? `・${effPlace}` : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-slate-400">
                      ここでの変更はこの日のこのコースだけの上書きです。毎日の標準はコース設定で変更します。
                    </p>
                  </div>
                ) : null}
              </div>

              {/* 保存状態 */}
              <div className="flex items-center justify-between border-t border-slate-200/80 px-4 py-3">
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      autoSaving > 0 ? "bg-amber-400 animate-pulse" : "bg-emerald-500",
                    )}
                  />
                  {autoSaving > 0 ? "保存中…" : "✓ 保存済み"}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingCell(null)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-900"
                >
                  完了
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
      <ShiftSubmitSettingsModal
        open={settingsModalOpen}
        canWrite={canWrite}
        onClose={() => setSettingsModalOpen(false)}
      />
      <ShiftImportModal
        open={importModalOpen}
        year={yearMonth.year}
        month={yearMonth.month}
        courses={courses}
        drivers={drivers}
        files={importFiles}
        onFilesChange={setImportFiles}
        onClose={() => setImportModalOpen(false)}
        onApplied={() => {
          void load();
        }}
        onChangeTarget={(y, m) => setYearMonth({ year: y, month: m })}
      />
      {/* ドラッグ中の全画面ドロップフィールド。drop 自体は window リスナが受けるため pointer-events は切る */}
      {dropActive && (
        <div className="fixed inset-0 z-[60] bg-slate-900/50 p-4 md:p-8 pointer-events-none">
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-4 border-dashed border-white/80 text-white">
            <FontAwesomeIcon icon={faFileImport} className="text-4xl" />
            <p className="text-lg font-semibold">シフト表をここにドロップ</p>
            <p className="text-sm text-white/80">PDF / JPEG / PNG（複数可）を AI で読み取って取り込みます</p>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
