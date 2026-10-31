"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUp,
  faChevronDown,
  faCropSimple,
  faDownload,
  faEllipsis,
  faEye,
  faEyeSlash,
  faFileCode,
  faFileCsv,
  faFileImport,
  faFillDrip,
  faFilePdf,
  faGripLines,
  faImage,
  faLock,
  faMagnifyingGlass,
  faMinus,
  faPlus,
  faRotateLeft,
  faSlash,
  faTriangleExclamation,
  faTruck,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { apiFetch, apiUpload, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { pngToPdf } from "@/lib/pdfExport";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/ui/popover";
import { CourseChip } from "@/lib/components/CourseChip";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { useCellCursors } from "@/lib/realtime/cellCursors";
import { useSelectedColumnAnchor } from "@/lib/shiftMemo/useSelectedColumnAnchor";
import { useSharedBoard } from "@/lib/shiftMemo/useSharedBoard";
import { readHiddenPeople, type Board } from "@/lib/shiftMemo/sharedBoardSync";
import { exportShiftMemo, exportShiftMemoCsv, parseShiftMemoTransfer, type ShiftMemoBoardData, type TransferLane, type TransferPerson } from "@/lib/shiftMemo/transfer";
import { imageRowDefaultTarget, mergeImageMemoRead, parseImageMemoRead, type ImageMemoRead } from "@/lib/shiftMemo/imageImport";
import {
  exportBodySlices,
  exportRangeFromHeader,
  exportDateLabel,
  exportDateRangeFromColumns,
  exportEdgeVelocity,
  exportPeriodLabel,
  selectedShortageCount,
} from "@/lib/shiftMemoExport";
import {
  MEMO_BACKGROUND_COLORS, readBackgroundColors, memoBackgroundColor, paintMemoBackground, memoWorkDays, memoUnassignedPeople, type MemoBackground,
  activityLabel,
  cellKey,
  fullDayOffByDate,
  nextDayOverride,
  MAX_REQUIRED_COUNT,
  readRequiredCountOverrides,
  resolveDayStaffing,
  updateRequiredCountOverride,
  resolveDayActivity,
  type DayOverride,
  type ShiftRequestLike,
} from "@/lib/shiftMemo/board";
import { cn } from "@/lib/ui/utils";
import { ReflectShiftMemoDialog } from "./ReflectShiftMemoDialog";
import { MemoReadProgressDialog } from "./MemoReadProgressDialog";
import { ImageMemoImportDialog } from "./ImageMemoImportDialog";

type MemoCourse = {
  id: string;
  name: string;
  summary_title?: string | null;
  color: string;
  max_drivers?: number | null;
  counterparty_invoice_address_id?: string | null;
  uses_cycles?: boolean | null;
  course_cycles?: {
    cycle_no: number;
    label?: string | null;
    max_drivers?: number | null;
    active?: boolean | null;
  }[] | null;
};

type MemoDriver = {
  id: string;
  name: string;
  display_name?: string | null;
  driver_code?: string | null;
};

type RouteGroup = {
  id: string;
  name: string;
  carrier: string;
  color: string;
  defaultRequiredCount: number;
};

type AssignmentLane = TransferLane;
type AssignedPerson = TransferPerson;

type PersonToken = {
  personKey: string;
  driverId?: string;
  name: string;
  sourceKey?: string;
  placementId?: string;
};

type PanelAnchor = { left: number; top: number; right: number; bottom: number };
type ActivePanel =
  | { kind: "add"; routeId: string; anchor: PanelAnchor }
  | { kind: "edit"; laneId: string; anchor: PanelAnchor }
  | { kind: "required"; laneId: string; date: string; anchor: PanelAnchor }
  | null;
type ExportSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
  routeIds: string[];
  laneIds: string[];
};
type ExportArtifacts = { png: Blob; pdf: Blob; filename: string };
type ExportCellAnchor = { dayIndex: number; rowIndex: number };

type MemoSelection = { kind: "column"; date: string } | { kind: "cell"; date: string; laneId: string } | { kind: "row"; laneId: string } | { kind: "course"; routeId: string };

// 選択範囲の外周だけを描き、セル同士の境目に枠を重ねない。
function memoGridStyle(selected: boolean, edges: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } = {}): React.CSSProperties {
  const shadows: string[] = [];
  const edgeColor = "rgba(99,102,241,0.65)";
  if (selected) {
    if (edges.top) shadows.push(`inset 0 1px 0 ${edgeColor}`);
    if (edges.right) shadows.push(`inset -1px 0 0 ${edgeColor}`);
    if (edges.bottom) shadows.push(`inset 0 -1px 0 ${edgeColor}`);
    if (edges.left) shadows.push(`inset 1px 0 0 ${edgeColor}`);
  }
  if (!selected || !edges.right) shadows.push("inset -1px 0 0 #edf0f5");
  if (selected) shadows.push("inset 0 0 0 9999px rgba(99,102,241,0.10)");
  return { boxShadow: shadows.join(", ") };
}

type StoredBoard = ShiftMemoBoardData;

const WEEKDAY_OPTIONS = [
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
  { value: 0, label: "日" },
];
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];
const PERSON_COLORS = ["#06b6d4", "#8b5cf6", "#f97316", "#22c55e", "#3b82f6", "#ec4899"];
const PERSON_DRAG_TYPE = "application/x-hakotora-personal-shift-memo-person";
const EMPTY_SHIFT_REQUESTS: ShiftRequestLike[] = [];
const LANE_DRAG_TYPE = "application/x-hakotora-personal-shift-memo-lane";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function dateInfo(date: string): { day: number; weekday: string; weekdayNo: number; monthDay: string } {
  const value = new Date(`${date}T12:00:00`);
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return {
    day: value.getDate(),
    weekday: labels[value.getDay()],
    weekdayNo: value.getDay(),
    monthDay: `${value.getMonth() + 1}月${value.getDate()}日`,
  };
}

function colorForPerson(key: string): string {
  let sum = 0;
  for (const char of key) sum += char.charCodeAt(0);
  return PERSON_COLORS[sum % PERSON_COLORS.length];
}

function assignedCount(people: AssignedPerson[]): number {
  return new Set(people.map((person) => person.personKey)).size;
}

function exportDateRange(
  selection: ExportSelection,
  laneWidth: number,
  dayWidth: number,
  dates: string[],
): { start: string; end: string } {
  return exportDateRangeFromColumns(selection.x, selection.width, laneWidth, dayWidth, dates);
}

function weekdaySummary(activeWeekdays: number[]): string {
  return WEEKDAY_OPTIONS.filter((weekday) => activeWeekdays.includes(weekday.value))
    .map((weekday) => weekday.label)
    .join("・");
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function floatingPanelPosition(anchor: PanelAnchor, width: number, height: number) {
  const margin = 12;
  const gap = 8;
  const safeWidth = Math.min(width, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - safeWidth - margin));
  const top = anchor.bottom + gap + height <= window.innerHeight - margin
    ? anchor.bottom + gap
    : Math.max(margin, anchor.top - height - gap);
  return { left, top, width: safeWidth };
}

function defaultLanes(courses: MemoCourse[]): AssignmentLane[] {
  return courses.flatMap((course) => {
    const baseName = course.summary_title?.trim() || course.name;
    const cycles = course.uses_cycles
      ? (course.course_cycles ?? []).filter((cycle) => cycle.active !== false)
      : [];
    if (cycles.length > 0) {
      return cycles.map((cycle) => ({
        id: `base-${course.id}-${cycle.cycle_no}`,
        routeId: course.id,
        name: cycle.label?.trim() || `C${cycle.cycle_no}`,
        color: course.color || "#94a3b8",
        activeWeekdays: [...MON_TO_SAT],
        requiredCount: Math.max(1, cycle.max_drivers ?? course.max_drivers ?? 1),
        custom: false,
      }));
    }
    return [{
      id: `base-${course.id}`,
      routeId: course.id,
      name: baseName,
      color: course.color || "#94a3b8",
      activeWeekdays: [...MON_TO_SAT],
      requiredCount: Math.max(1, course.max_drivers ?? 1),
      custom: false,
    }];
  });
}

function PersonSlip({
  token,
  code,
  selected,
  dayOff,
  workDays,
  onSelect,
  onRemove,
}: {
  token: PersonToken;
  code?: string | null;
  selected: boolean;
  /** その日に全休の希望を出している人。置けなくはしないが、気づけるようにする */
  dayOff?: boolean;
  workDays?: number;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <button
      data-shift-export-slip="true"
      type="button"
      draggable
      aria-pressed={selected}
      aria-description={workDays !== undefined ? `表示期間の稼働${workDays}日` : undefined}
      title={`${token.name}${code ? `（${code}）` : ""}${dayOff ? " ・この日は希望休" : ""}${workDays !== undefined ? ` ・稼働${workDays}日` : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (onRemove && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          onRemove();
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = token.sourceKey ? "move" : "copy";
        event.dataTransfer.setData(PERSON_DRAG_TYPE, JSON.stringify(token));
      }}
      className={cn(
        "inline-flex min-h-7 max-w-full cursor-grab items-center overflow-hidden rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)] outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-indigo-500",
        selected && "ring-2 ring-indigo-500",
        dayOff && "border-rose-200 bg-rose-50 text-rose-700",
      )}
      style={{ borderLeftColor: colorForPerson(token.personKey), borderLeftWidth: 3 }}
    >
      <span data-shift-export-slip-text="true" className="min-w-0 truncate px-2 py-1">{token.name}</span>
      {dayOff && <span data-shift-export-slip-off="true" className="shrink-0 border-l border-rose-200 px-1 py-1 text-[8px] font-bold text-rose-600">休</span>}
      {workDays !== undefined && <span aria-hidden="true" className="shrink-0 border-l border-slate-100 px-1.5 py-1 text-[9px] tabular-nums text-slate-500">{workDays}日</span>}
      {code && !token.sourceKey && <span className="shrink-0 border-l border-slate-100 px-1.5 py-1 font-mono text-[8px] text-slate-400">{code}</span>}
    </button>
  );
}

export default function PersonalShiftMemoBoard({
  dates,
  courses,
  drivers,
  today,
  shiftRequests = EMPTY_SHIFT_REQUESTS,
  storageNamespace,
  toolbarLeading,
  mode = "personal",
  canEdit = true,
  onPendingChange,
  canReflect = false,
  onReflected,
}: {
  dates: string[];
  courses: MemoCourse[];
  drivers: MemoDriver[];
  today: string;
  /** 提出済みの希望休。メモ盤では全休だけを「この日は休み希望」として印に使う */
  shiftRequests?: ShiftRequestLike[];
  /** 保存先を分けたいとき（プレビューで本物の下書きを汚さない）に指定する */
  storageNamespace?: string;
  toolbarLeading?: React.ReactNode;
  mode?: "personal" | "shared";
  canEdit?: boolean;
  onPendingChange?: (pending: boolean) => void;
  canReflect?: boolean;
  onReflected?: () => Promise<unknown>;
}) {
  const viewerId = storageNamespace ?? getStoredDriver()?.id ?? "local";
  // 個人モードの保存キーは維持する。共有モードではこのキーを読み書きしない。
  const storageKey = `hakotora_personal_shift_memo_v1:${viewerId}`;
  const backupKey = `${storageKey}:before-import`;
  const initialLanes = useMemo(() => defaultLanes(courses), [courses]);
  const [invoiceAddressNames, setInvoiceAddressNames] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  // 日付の選択は外すこともできる（表の外を押すと青い枠が消える）
  const [selectedDate, setSelectedDate] = useState<string | null>(dates.includes(today) ? today : dates[0] ?? null);
  useEffect(() => { setSelectedDate(current => current === null || dates.includes(current) ? current : dates[0] ?? null); },[dates]);
  const [dayWidth, setDayWidth] = useState(76);
  const [laneWidth, setLaneWidth] = useState(190);
  const [detailWidth, setDetailWidth] = useState(330);
  const [lanes, setLanes] = useState<AssignmentLane[]>(initialLanes);
  const [laneOrder, setLaneOrder] = useState<string[]>(initialLanes.map((lane) => lane.id));
  const [hiddenLaneIds, setHiddenLaneIds] = useState<string[]>([]);
  // コース単位の並び替え・非表示。運用しているのは一部のコースだけなので、上に寄せて残りは畳む
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [hiddenRouteIds, setHiddenRouteIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, AssignedPerson[]>>({});
  const [extraPeople, setExtraPeople] = useState<string[]>([]);
  const [hiddenPeople, setHiddenPeople] = useState<Record<string, true>>({});
  const [hiddenPeopleOpen, setHiddenPeopleOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // 曜日の設定に対する「この日だけ休み／稼働」。イレギュラーな休みをここで持つ
  const [dayOverrides, setDayOverrides] = useState<Record<string, DayOverride>>({});
  const [requiredCountOverrides, setRequiredCountOverrides] = useState<Record<string, number>>({});
  const [backgroundColors, setBackgroundColors] = useState<Record<string, MemoBackground>>({});
  const [selection, setSelection] = useState<MemoSelection | null>(null);
  const [colorScope, setColorScope] = useState("date");
  const [workDaysOpen, setWorkDaysOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const cursors = useCellCursors({
    scope: "shift-memo", selfName: getStoredDriver()?.name ?? "運営", enabled: mode === "shared",
    onRevision: () => setRemoteRevision((current) => current + 1),
  });
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customName, setCustomName] = useState("");
  const [selectedToken, setSelectedToken] = useState<PersonToken | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const activePanelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [newLaneName, setNewLaneName] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [settingsWeekdays, setSettingsWeekdays] = useState<number[]>([]);
  const [settingsRequiredCount, setSettingsRequiredCount] = useState(1);
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    token: PersonToken;
    targetKey: string;
    existingNames: string[];
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boardScrollerRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const exportOverlayRef = useRef<HTMLDivElement | null>(null);
  const exportSelectionStartRef = useRef<ExportCellAnchor | null>(null);
  const exportPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const exportAutoScrollFrameRef = useRef<number | null>(null);
  const exportArtifactsRef = useRef<ExportArtifacts | null>(null);
  const exportGenerationRef = useRef(0);
  const [exportMode, setExportMode] = useState(false);
  const [exportSelection, setExportSelection] = useState<ExportSelection | null>(null);
  const [exportPreviewUrl, setExportPreviewUrl] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [reflectOpen, setReflectOpen] = useState(false);
  const transferInputRef = useRef<HTMLInputElement>(null);
  const [transferError, setTransferError] = useState("");
  const [pendingTransfer, setPendingTransfer] = useState<{
    board: StoredBoard; fileName: string; placementCount: number; unregisteredNames: string[];
  } | null>(null);
  const [backupAvailable, setBackupAvailable] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [imageReadBusy, setImageReadBusy] = useState(false);
  const [readingFileName, setReadingFileName] = useState("");
  const [failedReadFile, setFailedReadFile] = useState<File | null>(null);
  const readAbortRef = useRef<AbortController | null>(null);
  const fileDragDepth = useRef(0);
  const [fileDragOver, setFileDragOver] = useState(false);
  useEffect(() => () => { const controller = readAbortRef.current; readAbortRef.current = null; controller?.abort(); }, []);
  const cancelImageRead = () => {
    readAbortRef.current?.abort(); readAbortRef.current = null;
    setImageReadBusy(false);
  };
  const [pendingImage, setPendingImage] = useState<{ file: File; read: ImageMemoRead; targets: string[] } | null>(null);

  const currentBoard = (): StoredBoard => ({
    version: 1, lanes, laneOrder, hiddenLaneIds, routeOrder, hiddenRouteIds,
    assignments, extraPeople, hiddenPeople, notes, dayOverrides, requiredCountOverrides, backgroundColors,
    widths: { day: dayWidth, lane: laneWidth, detail: detailWidth },
  });

  const downloadMemoData = (format: "json" | "csv") => {
    const blob = format === "json"
      ? new Blob([exportShiftMemo(currentBoard())], { type: "application/json" })
      : new Blob([exportShiftMemoCsv(currentBoard(), courses, dates)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `ハコ虎_シフトメモ_${date}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setTransferError("");
  };

  const receiveMemoData = async (file: File | undefined) => {
    if (!file || readAbortRef.current) return;
    if (mode !== "personal") { setTransferError("個人メモを開いて読み込んでください"); return; }
    if (exportMode) { setTransferError("エクスポートを終了してから読み込んでください"); return; }
    if (pendingImage || pendingTransfer || reflectOpen || activePanel) { setTransferError("確認中の画面を閉じてから読み込んでください"); return; }
    const controller = new AbortController(); readAbortRef.current = controller;
    setTransferError(""); setFailedReadFile(null);
    try {
      if (/\.(png|pdf)$/i.test(file.name)) {
        if (mode !== "personal") throw new Error("画像・PDFは個人メモで読み込んでください");
        if (file.size > 8 * 1024 * 1024) throw new Error("画像・PDFが大きすぎます");
        setReadingFileName(file.name); setImageReadBusy(true);
        const form = new FormData();
        form.set("file", file);
        form.set("year", String(Number(dates[0].slice(0, 4))));
        form.set("month", String(Number(dates[0].slice(5, 7))));
        const result = await apiUpload<ImageMemoRead>("/api/admin/shifts/memo/read", form, controller.signal);
        if (controller.signal.aborted) return;
        const read = parseImageMemoRead(result, { year: Number(dates[0].slice(0, 4)), month: Number(dates[0].slice(5, 7)) });
        setPendingImage({ file, read, targets: read.rows.map(row => imageRowDefaultTarget(row.name, lanes, courses)) });
        return;
      }
      if (!/\.json$/i.test(file.name)) throw new Error("JSON、PNG、PDFを選んでください");
      if (file.size > 4 * 1024 * 1024) throw new Error("メモのデータファイルが大きすぎます");
      const parsed = parseShiftMemoTransfer(await file.text(), {
        courseIds: courses.map((course) => course.id), driverIds: drivers.map((driver) => driver.id),
      });
      if (!controller.signal.aborted) setPendingTransfer({ ...parsed, fileName: file.name });
    } catch (error) {
      if (!controller.signal.aborted) { setTransferError(error instanceof Error ? error.message : "メモを読み取れませんでした"); if (/\.(png|pdf)$/i.test(file.name)) setFailedReadFile(file); }
    } finally {
      if (readAbortRef.current === controller) { readAbortRef.current = null; setImageReadBusy(false); }
      if (transferInputRef.current) transferInputRef.current.value = "";
    }
  };

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types?.includes("Files") || !!event.dataTransfer.files?.length;
  const receiveMemoFiles = (files: FileList) => {
    fileDragDepth.current = 0; setFileDragOver(false);
    if (files.length !== 1) { setTransferError("ファイルを1つずつ読み込んでください"); return; }
    void receiveMemoData(files[0]);
  };
  const fileDropReceiverRef = useRef(receiveMemoFiles);
  fileDropReceiverRef.current = receiveMemoFiles;
  useEffect(() => {
    const over = (event: globalThis.DragEvent) => { if(event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    const drop = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault(); fileDropReceiverRef.current(event.dataTransfer.files);
    };
    window.addEventListener("dragover",over); window.addEventListener("drop",drop);
    return () => { window.removeEventListener("dragover",over); window.removeEventListener("drop",drop); };
  }, []);
  const dropMemoFile = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); receiveMemoFiles(event.dataTransfer.files);
  };

  const applyImageMemo = (activateDays: boolean) => {
    if (!pendingImage) return;
    try {
      const next = mergeImageMemoRead(currentBoard(), pendingImage.read, pendingImage.targets, courses, drivers, { activateDays });
      localStorage.setItem(backupKey, JSON.stringify(currentBoard()));
      localStorage.setItem(storageKey, JSON.stringify(next));
      applyBoard(next);
      setBackupAvailable(true);
      setPendingImage(null);
      setTransferError("");
      setLiveMessage("画像の読み取り結果をメモに保存しました");
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "メモに保存できませんでした");
    }
  };

  const applyReceivedMemo = () => {
    if (!pendingTransfer) return;
    try {
      localStorage.setItem(backupKey, JSON.stringify(currentBoard()));
      localStorage.setItem(storageKey, JSON.stringify(pendingTransfer.board));
      applyBoard(pendingTransfer.board);
      setBackupAvailable(true);
      setTransferError("");
      setLiveMessage("受け取ったメモをこの端末に保存しました");
      setPendingTransfer(null);
    } catch {
      setTransferError("この端末に保存できませんでした。空き容量を確認してください");
    }
  };

  const restoreBeforeImport = () => {
    try {
      const saved = localStorage.getItem(backupKey);
      if (!saved) throw new Error("保存した状態がありません");
      const parsed = parseShiftMemoTransfer(
        JSON.stringify({ format: "hakotora-shift-memo", version: 1, board: JSON.parse(saved) }),
        { courseIds: courses.map((course) => course.id), driverIds: drivers.map((driver) => driver.id) },
      );
      localStorage.setItem(storageKey, JSON.stringify(parsed.board));
      applyBoard(parsed.board);
      localStorage.removeItem(backupKey);
      setBackupAvailable(false);
      setTransferError("");
      setLiveMessage("読み込み前のメモに戻しました");
    } catch {
      setTransferError("読み込み前のメモに戻せませんでした");
    } finally {
      setRestorePending(false);
    }
  };

  // 曜日の設定＋その日だけの例外で「動くかどうか」を決める。
  const dayActivity = (lane: AssignmentLane, date: string) =>
    resolveDayActivity(lane.activeWeekdays, dateInfo(date).weekdayNo, dayOverrides[cellKey(lane.id, date)]);
  const activeOn = (lane: AssignmentLane, date: string) => dayActivity(lane, date).active;
  const staffingOn = (lane: AssignmentLane, date: string, people: AssignedPerson[]) =>
    resolveDayStaffing(lane.requiredCount, requiredCountOverrides[cellKey(lane.id, date)], activeOn(lane, date), assignedCount(people));
  const shortageFor = (lane: AssignmentLane, date: string, people: AssignedPerson[]) =>
    staffingOn(lane, date, people).shortage;

  /** その日だけ休み／稼働を切り替える。曜日の設定に戻るときは例外ごと捨てる */
  const toggleDayActivity = (lane: AssignmentLane, date: string) => {
    const key = cellKey(lane.id, date);
    const next = nextDayOverride(lane.activeWeekdays, dateInfo(date).weekdayNo, dayOverrides[key]);
    setDayOverrides((current) => {
      const copy = { ...current };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
    const nextActive = resolveDayActivity(lane.activeWeekdays, dateInfo(date).weekdayNo, next).active;
    setLiveMessage(`${dateInfo(date).monthDay}の${lane.name}を${nextActive ? "稼働" : "休み"}にしました`);
  };

  useEffect(() => {
    setSelection(current => {
      if (!current) return null;
      if ((current.kind === "column" || current.kind === "cell") && !dates.includes(current.date)) return dates[0] ? {kind:"column",date:dates[0]} : null;
      if ((current.kind === "cell" || current.kind === "row") && !lanes.some(lane => lane.id === current.laneId && !hiddenLaneIds.includes(lane.id) && !hiddenRouteIds.includes(lane.routeId))) return null;
      if (current.kind === "course" && (!courses.some(course => course.id === current.routeId) || hiddenRouteIds.includes(current.routeId))) return null;
      return current;
    });
  },[dates,lanes,courses,hiddenLaneIds,hiddenRouteIds]);

  // 日付 → その日に全休の希望を出している人。正式シフト表と同じく便指定は含めない
  const dayOffByDate = useMemo(() => fullDayOffByDate(shiftRequests), [shiftRequests]);
  const dayOffOn = (date: string | null) => (date ? dayOffByDate.get(date) : undefined);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ addresses: { id: string; name: string }[] }>("/api/admin/invoice-addresses")
      .then((result) => {
        if (!cancelled) setInvoiceAddressNames(Object.fromEntries((result.addresses ?? []).map((address) => [address.id, address.name])));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const routeGroups = useMemo<RouteGroup[]>(() => courses.map((course) => ({
    id: course.id,
    name: course.summary_title?.trim() || course.name,
    carrier: course.counterparty_invoice_address_id
      ? invoiceAddressNames[course.counterparty_invoice_address_id] ?? "取引先未設定"
      : "取引先未設定",
    color: course.color || "#94a3b8",
    defaultRequiredCount: Math.max(1, course.max_drivers ?? 1),
  })), [courses, invoiceAddressNames]);

  const initialLanesRef = useRef(initialLanes);
  initialLanesRef.current = initialLanes;
  const normalizeBoard = useCallback((stored: Board): Board => {
    const saved = stored as Partial<StoredBoard>;
    const storedLanes = saved.version === 1 && Array.isArray(saved.lanes) ? saved.lanes : [];
    const knownIds = new Set(storedLanes.map(lane => lane.id));
    const mergedLanes = [...storedLanes, ...initialLanesRef.current.filter(lane => !knownIds.has(lane.id))];
    return {
      version: 1, lanes: mergedLanes,
      laneOrder: [...(saved.laneOrder ?? []).filter(id => mergedLanes.some(lane => lane.id === id)),
        ...mergedLanes.map(lane => lane.id).filter(id => !(saved.laneOrder ?? []).includes(id))],
      hiddenLaneIds: Array.isArray(saved.hiddenLaneIds) ? saved.hiddenLaneIds : [],
      routeOrder: Array.isArray(saved.routeOrder) ? saved.routeOrder : [],
      hiddenRouteIds: Array.isArray(saved.hiddenRouteIds) ? saved.hiddenRouteIds : [],
      assignments: saved.assignments && typeof saved.assignments === "object" ? saved.assignments : {},
      extraPeople: Array.isArray(saved.extraPeople) ? saved.extraPeople : [],
      hiddenPeople: readHiddenPeople(saved.hiddenPeople),
      notes: saved.notes && typeof saved.notes === "object" ? saved.notes : {},
      dayOverrides: saved.dayOverrides && typeof saved.dayOverrides === "object" ? saved.dayOverrides : {},
      requiredCountOverrides: readRequiredCountOverrides(saved.requiredCountOverrides),
      backgroundColors: readBackgroundColors(saved.backgroundColors),
      widths: { day: Math.max(56, Math.min(140, saved.widths?.day || 76)),
        lane: Math.max(150, Math.min(300, saved.widths?.lane || 190)),
        detail: Math.max(280, Math.min(520, saved.widths?.detail || 330)) },
    };
  }, []);
  const applyBoard = useCallback((stored: Partial<StoredBoard>) => {
    const board = normalizeBoard(stored as Board) as StoredBoard;
    setLanes(board.lanes); setLaneOrder(board.laneOrder); setHiddenLaneIds(board.hiddenLaneIds);
    setRouteOrder(board.routeOrder ?? []); setHiddenRouteIds(board.hiddenRouteIds ?? []);
    setAssignments(board.assignments); setExtraPeople(board.extraPeople); setHiddenPeople(board.hiddenPeople ?? {}); setNotes(board.notes);
    setBackgroundColors(board.backgroundColors ?? {});
    setDayOverrides(board.dayOverrides ?? {}); setRequiredCountOverrides(board.requiredCountOverrides ?? {});
    setDayWidth(board.widths?.day ?? 76); setLaneWidth(board.widths?.lane ?? 190); setDetailWidth(board.widths?.detail ?? 330);
  }, [normalizeBoard]);
  const shared = useSharedBoard({
    enabled: mode === "shared", identity: [viewerId, getStoredDriver()?.companyCode, getStoredDriver()?.officeCode].filter(Boolean).join(":"), board: currentBoard() as unknown as Board, canEdit,
    normalize: normalizeBoard, apply: applyBoard, onPendingChange,
    announceRevision: cursors.announceRevision, connected: cursors.connected, remoteRevision,
  });
  const boardHydrated = mode === "shared" ? shared.ready : hydrated;
  const displaySaveError = mode === "shared" ? shared.error : saveError;

  // coursesの更新は不足する担当枠だけを追加する。保存状態の再取得・初期化はしない。
  useEffect(() => {
    if (!boardHydrated) return;
    setLanes(current => {
      const ids = new Set(current.map(lane => lane.id));
      const additions = initialLanes.filter(lane => !ids.has(lane.id));
      return additions.length ? [...current, ...additions] : current;
    });
    setLaneOrder(current => {
      const additions = initialLanes.map(lane => lane.id).filter(id => !current.includes(id));
      return additions.length ? [...current, ...additions] : current;
    });
  }, [initialLanes, boardHydrated]);

  useEffect(() => {
    if (mode !== "personal") return;
    setHydrated(false);
    try {
      const raw = localStorage.getItem(storageKey);
      applyBoard(raw ? JSON.parse(raw) as StoredBoard : { version: 1, lanes: [] });
      setBackupAvailable(!!localStorage.getItem(backupKey));
      setSaveError(null);
    } catch { setSaveError("この端末に保存したメモを読み込めませんでした"); }
    setHydrated(true);
  }, [storageKey, backupKey, mode, applyBoard]);

  useEffect(() => {
    if (!hydrated || mode !== "personal") return;
    const serialized = JSON.stringify(currentBoard());
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, serialized);
        setSaveError(null); setSavedAt(Date.now());
      } catch { setSaveError("端末へ保存できませんでした。ブラウザの保存容量を確認してください"); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [saveRevision, backgroundColors, assignments, requiredCountOverrides, dayOverrides, dayWidth, detailWidth, extraPeople, hiddenPeople, hiddenLaneIds, hiddenRouteIds, hydrated, laneOrder, laneWidth, lanes, notes, routeOrder, storageKey, mode]);

  useEffect(() => {
    if (!activePanel) return;
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[role=dialog]")) return;
      setActivePanel(null);
      requestAnimationFrame(() => activePanelTriggerRef.current?.focus({ preventScroll: true }));
    };
    const reposition = () => {
      const rect = activePanelTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setActivePanel((current) => current ? {
        ...current,
        anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      } : null);
    };
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
    };
  }, [activePanel]);

  // メモ盤の外を押したら日付の選択を外す（選んだ列の青い枠を残さない）
  useEffect(() => {
    if ((!selectedDate && !selection) || reflectOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      // 盤・右パネル・浮いているパネル（body 直下に出る）の中は対象外
      if (rootRef.current?.contains(target)) return;
      if (target.closest?.("[role='dialog'], [data-custom-select-popup]")) return;
      setSelectedDate(null);setSelection(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [selectedDate, selection, reflectOpen]);

  const orderedLanes = useMemo(() => {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    const routeIds = new Set(routeGroups.map((route) => route.id));
    return laneOrder
      .map((id) => byId.get(id))
      .filter((lane): lane is AssignmentLane => !!lane && routeIds.has(lane.routeId));
  }, [laneOrder, lanes, routeGroups]);
  // 保存した順にコースを並べ、知らないコース（新設）は後ろへ回す
  const orderedRoutes = useMemo(() => {
    const byId = new Map(routeGroups.map((route) => [route.id, route]));
    const known = routeOrder.map((id) => byId.get(id)).filter((route): route is RouteGroup => !!route);
    const knownIds = new Set(known.map((route) => route.id));
    return [...known, ...routeGroups.filter((route) => !knownIds.has(route.id))];
  }, [routeGroups, routeOrder]);
  const visibleRoutes = orderedRoutes.filter((route) => !hiddenRouteIds.includes(route.id));
  const hiddenRoutes = orderedRoutes.filter((route) => hiddenRouteIds.includes(route.id));
  const visibleLanes = orderedLanes.filter((lane) => !hiddenLaneIds.includes(lane.id) && !hiddenRouteIds.includes(lane.routeId));
  const hiddenLanes = orderedLanes.filter((lane) => hiddenLaneIds.includes(lane.id) && !hiddenRouteIds.includes(lane.routeId));

  /** そのコースを一番上へ。よく使う順に押していけば並べ替えられる（ドラッグは使わない） */
  const moveRouteToTop = (routeId: string) => {
    setRouteOrder([routeId, ...orderedRoutes.map((route) => route.id).filter((id) => id !== routeId)]);
    setLiveMessage(`${routeGroups.find((route) => route.id === routeId)?.name ?? "コース"}を一番上にしました`);
  };
  const filteredDrivers = drivers.filter((driver) => {
    const query = search.trim().toLocaleLowerCase("ja-JP");
    return !hiddenPeople[`driver:${driver.id}`] && (!query || `${getDisplayName(driver)} ${driver.driver_code ?? ""}`.toLocaleLowerCase("ja-JP").includes(query));
  });
  const candidates: PersonToken[] = [
    ...drivers.map(driver => ({ personKey: `driver:${driver.id}`, driverId: driver.id, name: getDisplayName(driver) })),
    ...extraPeople.map(name => ({ personKey: `custom:${name}`, name })),
  ];
  const unassignedByDate = memoUnassignedPeople(candidates, lanes.filter(lane => courses.some(course => course.id === lane.routeId)), assignments, dates, hiddenPeople);
  const hiddenCandidates = candidates.filter(token => hiddenPeople[token.personKey]);
  const visibleCustomPeople = extraPeople.filter(name => !hiddenPeople[`custom:${name}`]);
  const workDays = useMemo(() => memoWorkDays(lanes.filter(lane => courses.some(course => course.id === lane.routeId)),assignments,dates,dayOverrides),[lanes,courses,assignments,dates,dayOverrides]);
  const workDayPeople = [...candidates, ...[...workDays].filter(([key]) => !candidates.some(person => person.personKey === key)).map(([personKey,entry]) => ({ personKey,name: entry.name }))];
  const selectedLane = selection && (selection.kind === "row" || selection.kind === "cell") ? lanes.find(lane => lane.id === selection.laneId) : undefined;
  const selectedRoute = selection?.kind === "course" ? routeGroups.find(route => route.id === selection.routeId) : undefined;
  const selectionCourse = selectedLane ? routeGroups.find(route => route.id === selectedLane.routeId) : selectedRoute;
  const laneLabel = (lane: AssignmentLane) => {
    const parent = routeGroups.find(route => route.id === lane.routeId)?.name;
    return parent && parent !== lane.name ? `${parent} ${lane.name}` : lane.name;
  };
  const selectionLabel = !selection ? "" : selection.kind === "column" ? `${dateInfo(selection.date).monthDay}（${dateInfo(selection.date).weekday}）・1列`
    : selection.kind === "cell" ? `${selectedLane ? laneLabel(selectedLane) : "担当枠"}・${dateInfo(selection.date).monthDay}`
    : selection.kind === "row" ? `${selectedLane ? laneLabel(selectedLane) : "担当枠"}・${dates.length}日分` : `${selectedRoute?.name ?? "コース"}の行`;
  const selectedCellRequiredCount = selection?.kind === "cell" && selectedLane ? requiredCountOverrides[cellKey(selectedLane.id, selection.date)] ?? selectedLane.requiredCount : 0;
  const colorKey = !selection ? null : selection.kind === "column" ? colorScope === "weekday" ? `weekday:${dateInfo(selection.date).weekdayNo}` : `date:${selection.date}`
    : selection.kind === "cell" ? `cell:${cellKey(selection.laneId,selection.date)}` : selection.kind === "row" ? `row:${selection.laneId}` : `course:${selection.routeId}`;
  const changeBackground = (value: MemoBackground | null) => {
    if (!colorKey || !editable) return;
    setBackgroundColors(current => paintMemoBackground(current,colorKey,value,lanes.filter(lane => courses.some(course => course.id === lane.routeId)),dates));
  };
  const selectColumn = (date: string) => {if (exportMode) {selectExportHeader("column",date);return;}setSelectedDate(date);setSelection({kind:"column",date});setColorScope("date");};
  const selectCell = (laneId: string,date: string) => {setSelectedDate(date);setSelection({kind:"cell",laneId,date});setColorScope("date");};
  const selectRow = (laneId: string) => {if (exportMode) {selectExportHeader("row",laneId);return;}setSelectedDate(null);setSelection({kind:"row",laneId});};
  const selectCourse = (routeId: string) => {if (exportMode) {selectExportHeader("course",routeId);return;}setSelectedDate(null);setSelection({kind:"course",routeId});};
  const isRowSelected = (lane: AssignmentLane) => exportMode ? !!exportSelection?.laneIds.includes(lane.id) : selection?.kind === "row" && selection.laneId === lane.id || selection?.kind === "course" && selection.routeId === lane.routeId;
  const isCellSelected = (lane: AssignmentLane,date: string) => !exportMode && (isRowSelected(lane) || selection?.kind === "column" && selection.date === date || selection?.kind === "cell" && selection.date === date && selection.laneId === lane.id);
  const isColumnSelected = (date: string) => exportMode
    ? !!exportSelection && dates.indexOf(date) >= Math.round((exportSelection.x - laneWidth) / dayWidth) && dates.indexOf(date) < Math.round((exportSelection.x - laneWidth + exportSelection.width) / dayWidth)
    : selection?.kind === "column" && selection.date === date;
  const isCourseSelected = (routeId: string) => exportMode ? !!exportSelection?.routeIds.includes(routeId) : selection?.kind === "course" && selection.routeId === routeId;
  useSelectedColumnAnchor(boardScrollerRef,
    !exportMode && selection?.kind === "column" ? dates.indexOf(selection.date) : -1,
    dayWidth, laneWidth, boardHydrated, detailWidth);
  const selectedCandidate = selectedToken && !selectedToken.sourceKey && candidates.find(token => token.personKey === selectedToken.personKey);
  const editable = mode !== "shared" || canEdit;
  const boardWidth = laneWidth + dayWidth * dates.length;
  const activeLane = activePanel?.kind === "edit" ? lanes.find((lane) => lane.id === activePanel.laneId) : undefined;
  const requiredLane = activePanel?.kind === "required" ? lanes.find((lane) => lane.id === activePanel.laneId) : undefined;
  const dailyRequiredCount = requiredLane && activePanel?.kind === "required" ? staffingOn(requiredLane, activePanel.date, []).requiredCount : 0;
  const requiredCourseName = courses.find(course => course.id === requiredLane?.routeId)?.summary_title?.trim()
    || courses.find(course => course.id === requiredLane?.routeId)?.name || requiredLane?.name;
  const activeRoute = activePanel?.kind === "add" ? routeGroups.find((route) => route.id === activePanel.routeId) : undefined;

  const closeActivePanel = (restoreFocus = false) => {
    setActivePanel(null);
    if (restoreFocus) requestAnimationFrame(() => activePanelTriggerRef.current?.focus({ preventScroll: true }));
  };

  const startResize = (
    event: ReactPointerEvent,
    currentValue: number,
    onChange: (value: number) => void,
    min: number,
    max: number,
    direction: 1 | -1 = 1,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const onMove = (moveEvent: PointerEvent) => onChange(Math.max(min, Math.min(max, Math.round(currentValue + (moveEvent.clientX - startX) * direction))));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const exportRows = () => Array.from(boardRef.current?.querySelectorAll<HTMLElement>("[data-export-row]") ?? [])
    .map((element) => ({
      top: element.offsetTop,
      bottom: element.offsetTop + element.offsetHeight,
      routeId: element.dataset.exportRouteId ?? "",
      laneId: element.dataset.exportRow ?? "",
    }))
    .sort((a, b) => a.top - b.top);

  const cellAtExportPoint = (clientX: number, clientY: number): ExportCellAnchor | null => {
    const rows = exportRows();
    const overlay = exportOverlayRef.current;
    if (rows.length === 0 || !overlay || dates.length === 0) return null;
    const rect = overlay.getBoundingClientRect();
    const boardX = Math.max(laneWidth, Math.min(boardWidth - 1, clientX - rect.left + laneWidth));
    const boardY = Math.max(64, Math.min(overlay.offsetHeight + 63, clientY - rect.top + 64));
    const dayIndex = Math.max(0, Math.min(dates.length - 1, Math.floor((boardX - laneWidth) / dayWidth)));
    let rowIndex = rows.findIndex((row) => boardY >= row.top && boardY < row.bottom);
    if (rowIndex < 0) {
      rowIndex = rows.reduce((nearestIndex, row, index) => {
        const distance = Math.min(Math.abs(boardY - row.top), Math.abs(boardY - row.bottom));
        const nearest = rows[nearestIndex];
        const nearestDistance = Math.min(Math.abs(boardY - nearest.top), Math.abs(boardY - nearest.bottom));
        return distance < nearestDistance ? index : nearestIndex;
      }, 0);
    }
    return { dayIndex, rowIndex };
  };

  const selectionFromCells = (start: ExportCellAnchor, end: ExportCellAnchor): ExportSelection | null => {
    const rows = exportRows();
    if (!rows[start.rowIndex] || !rows[end.rowIndex]) return null;
    const firstDay = Math.min(start.dayIndex, end.dayIndex);
    const lastDay = Math.max(start.dayIndex, end.dayIndex);
    const firstRow = Math.min(start.rowIndex, end.rowIndex);
    const lastRow = Math.max(start.rowIndex, end.rowIndex);
    const selectedRows = rows.slice(firstRow, lastRow + 1);
    return {
      x: laneWidth + firstDay * dayWidth,
      y: rows[firstRow].top,
      width: (lastDay - firstDay + 1) * dayWidth,
      height: rows[lastRow].bottom - rows[firstRow].top,
      routeIds: Array.from(new Set(selectedRows.map((row) => row.routeId).filter(Boolean))),
      laneIds: selectedRows.map((row) => row.laneId),
    };
  };

  const exportSlices = (selection: ExportSelection) => {
    const board = boardRef.current;
    if (!board) return [];
    const headers = Array.from(board.querySelectorAll<HTMLElement>("[data-export-route-header]")).map((element) => ({
      routeId: element.dataset.exportRouteHeader ?? "",
      top: element.offsetTop,
      bottom: element.offsetTop + element.offsetHeight,
    }));
    return exportBodySlices(exportRows(), headers, selection.y, selection.y + selection.height).filter(slice => slice.kind === "row");
  };

  const updateExportSelectionAt = (clientX: number, clientY: number) => {
    const start = exportSelectionStartRef.current;
    const cell = cellAtExportPoint(clientX, clientY);
    if (start && cell) setExportSelection(selectionFromCells(start, cell));
  };

  const stopExportAutoScroll = () => {
    if (exportAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(exportAutoScrollFrameRef.current);
      exportAutoScrollFrameRef.current = null;
    }
    exportPointerRef.current = null;
  };

  const scrollExportAtPointer = () => {
    const scroller = boardScrollerRef.current;
    const pointer = exportPointerRef.current;
    if (!scroller || !pointer || !exportSelectionStartRef.current) return false;
    const rect = scroller.getBoundingClientRect();
    const cellAreaLeft = Math.min(rect.right, rect.left + laneWidth);
    const cellAreaTop = Math.min(rect.bottom, rect.top + 64);
    const scrollX = exportEdgeVelocity(pointer.clientX, cellAreaLeft, rect.right);
    const scrollY = exportEdgeVelocity(pointer.clientY, cellAreaTop, rect.bottom);
    if (scrollX === 0 && scrollY === 0) return false;
    const previousLeft = scroller.scrollLeft;
    const previousTop = scroller.scrollTop;
    if (scrollX !== 0) scroller.scrollLeft = previousLeft + scrollX;
    if (scrollY !== 0) scroller.scrollTop = previousTop + scrollY;
    const changed = scroller.scrollLeft !== previousLeft || scroller.scrollTop !== previousTop;
    if (changed) updateExportSelectionAt(pointer.clientX, pointer.clientY);
    return changed;
  };

  const startExportAutoScroll = () => {
    if (exportAutoScrollFrameRef.current !== null) return;
    const tick = () => {
      if (!exportSelectionStartRef.current || !exportPointerRef.current) {
        exportAutoScrollFrameRef.current = null;
        return;
      }
      scrollExportAtPointer();
      exportAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    exportAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => () => {
    if (exportAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(exportAutoScrollFrameRef.current);
    }
  }, []);

  const buildExportCanvas = async (selection: ExportSelection) => {
    if (!boardRef.current) throw new Error("表を読み取れませんでした");
    const { default: html2canvas } = await import("html2canvas");
    const selectedShortageByDate = new Map(dates.map((date) => [
      date,
      selectedShortageCount(selection.laneIds, (laneId) => {
        const lane = lanes.find((candidate) => candidate.id === laneId);
        return lane ? shortageFor(lane, date, assignments[cellKey(lane.id, date)] ?? []) : 0;
      }),
    ]));
    await document.fonts?.ready;
    const source = await html2canvas(boardRef.current, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      width: boardRef.current.scrollWidth,
      height: boardRef.current.scrollHeight,
      windowWidth: boardRef.current.scrollWidth,
      windowHeight: boardRef.current.scrollHeight,
      onclone: (clonedDocument) => {
        clonedDocument.querySelectorAll<HTMLElement>("[data-export-row-label='true']").forEach(label => {
          Object.assign(label.style, { display: "block", height: "18px", lineHeight: "12px", padding: "0 0 6px", top: "6px", overflow: "visible" });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-export-row-name='duplicate']").forEach(label => { label.style.display = "none"; });
        clonedDocument.querySelectorAll<HTMLElement>("[data-export-row], [data-shared-cell]").forEach(cell => { cell.style.borderBottomColor = "transparent"; });
        const setExportPillLabel = (pill: HTMLElement, text: string) => {
          const label = clonedDocument.createElement("span");
          label.textContent = text;
          Object.assign(label.style, {
            display: "block",
            position: "relative",
            top: "-3px",
            height: "14px",
            lineHeight: "14px",
            whiteSpace: "nowrap",
            transform: "none",
          });
          pill.replaceChildren(label);
        };
        const clonedScroller = clonedDocument.querySelector<HTMLElement>("[data-shift-export-scroller='true']");
        if (clonedScroller) {
          clonedScroller.scrollLeft = 0;
          clonedScroller.scrollTop = 0;
          clonedScroller.style.overflow = "visible";
        }
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-sticky='true']").forEach((element) => {
          Object.assign(element.style, {
            position: "relative",
            left: "auto",
            top: "auto",
            zIndex: "auto",
            transform: "none",
          });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-slip='true']").forEach((slip) => {
          slip.classList.remove("ring-2", "ring-indigo-500");
          const off = slip.querySelector<HTMLElement>("[data-shift-export-slip-off='true']");
          const name = slip.querySelector<HTMLElement>("[data-shift-export-slip-text='true']");
          if (off && name) {
            name.textContent = `${name.textContent ?? ""} 休`;
            off.remove();
          }
          Object.assign(slip.style, {
            display: "block",
            position: "relative",
            height: "28px",
            padding: "0",
          });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-slip-text='true']").forEach((label) => {
          Object.assign(label.style, {
            display: "block",
            boxSizing: "border-box",
            position: "relative",
            top: "-2px",
            height: "26px",
            lineHeight: "14px",
            padding: "4px 8px 8px",
            transform: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-pill='true']").forEach((pill) => {
          const text = pill.textContent ?? "";
          Object.assign(pill.style, {
            boxSizing: "border-box",
            display: "inline-block",
            width: "auto",
            height: "14px",
            lineHeight: "normal",
            padding: "0 5px",
            fontSize: "8px",
            transform: "none",
            verticalAlign: "top",
            overflow: "hidden",
          });
          setExportPillLabel(pill, text);
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-required-trigger='true']").forEach((trigger) => {
          Object.assign(trigger.style, { boxShadow: "none", outline: "none", border: "0" });
          trigger.querySelectorAll<HTMLElement>("span").forEach((label) => { label.style.textDecoration = "none"; });
        });
        // html2canvasは内側の影を再現しないため、出力の列境界を実線へ置き換える。
        clonedDocument.querySelectorAll<HTMLElement>("[data-memo-grid='true']").forEach((element) => {
          Object.assign(element.style, { boxShadow: "none", borderRight: "1px solid #edf0f5", boxSizing: "border-box" });
        });
        // 編集中の選択色と外枠は画像へ残さず、保存した背景色は維持する。
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-selected='true']").forEach((element) => {
          element.classList.remove("text-indigo-700");
          element.style.boxShadow = "none";
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-meta='true']").forEach((meta) => {
          Object.assign(meta.style, { lineHeight: "10px", paddingTop: "0" });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-day='true']").forEach((day) => {
          Object.assign(day.style, {
            boxSizing: "border-box",
            display: "block",
            height: "64px",
            padding: "5px 2px 3px",
            textAlign: "center",
          });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-day-number='true']").forEach((number) => {
          Object.assign(number.style, { display: "block", height: "17px", lineHeight: "17px" });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-day-weekday='true']").forEach((weekday) => {
          Object.assign(weekday.style, { display: "block", height: "13px", lineHeight: "13px" });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-day-shortage]").forEach((badge) => {
          const date = badge.dataset.shiftExportDayShortage ?? "";
          const shortage = selectedShortageByDate.get(date) ?? 0;
          setExportPillLabel(badge, `不足${shortage}`);
          Object.assign(badge.style, {
            display: shortage > 0 ? "inline-block" : "none",
            marginTop: "3px",
          });
        });
      },
    });
    const sourceScaleX = source.width / boardRef.current.scrollWidth;
    const sourceScaleY = source.height / boardRef.current.scrollHeight;
    const dateCropX = Math.max(0, Math.round(selection.x * sourceScaleX));
    const dateCropWidth = Math.max(1, Math.min(source.width - dateCropX, Math.round(selection.width * sourceScaleX)));
    const bodySlices = exportSlices(selection).map((slice) => {
      const top = Math.max(0, Math.round(slice.top * sourceScaleY));
      return {
        top,
        height: Math.max(1, Math.min(source.height - top, Math.round((slice.bottom - slice.top) * sourceScaleY))),
        kind: slice.kind,
        routeId: slice.routeId,
      };
    });
    if (bodySlices.length === 0) throw new Error("選択範囲を読み取れませんでした");
    const bodyHeight = bodySlices.reduce((total, slice) => total + slice.height, 0);
    const labelWidth = Math.round(laneWidth * sourceScaleX);
    const tableHeaderHeight = Math.round(64 * sourceScaleY);
    const tableWidth = labelWidth + dateCropWidth;
    const headerHeight = Math.round(74 * sourceScaleY);
    const output = document.createElement("canvas");
    output.width = Math.max(tableWidth, Math.round(300 * sourceScaleX));
    output.height = headerHeight + tableHeaderHeight + bodyHeight;
    const context = output.getContext("2d");
    if (!context) throw new Error("画像を作成できませんでした");

    const range = exportDateRange(selection, laneWidth, dayWidth, dates);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
    context.fillStyle = "#f59e0b";
    context.fillRect(0, 0, output.width, Math.max(6, Math.round(4 * sourceScaleY)));
    context.fillStyle = "#0f172a";
    context.font = `800 ${Math.round(21 * sourceScaleY)}px sans-serif`;
    context.textBaseline = "top";
    context.fillText(exportDateLabel(range.start, range.end), Math.round(18 * sourceScaleX), Math.round(16 * sourceScaleY));
    context.fillStyle = "#64748b";
    context.font = `600 ${Math.round(10 * sourceScaleY)}px sans-serif`;
    context.fillText("シフトメモ・配置抜粋", Math.round(18 * sourceScaleX), Math.round(48 * sourceScaleY));
    if (output.width >= Math.round(520 * sourceScaleX)) {
      context.textAlign = "right";
      context.fillText(exportPeriodLabel(dates), output.width - Math.round(18 * sourceScaleX), Math.round(48 * sourceScaleY));
      context.textAlign = "left";
    }
    context.strokeStyle = "#e2e8f0";
    context.lineWidth = Math.max(1, Math.round(sourceScaleY));
    context.beginPath();
    context.moveTo(0, headerHeight - context.lineWidth / 2);
    context.lineTo(output.width, headerHeight - context.lineWidth / 2);
    context.stroke();
    context.drawImage(source, 0, 0, labelWidth, tableHeaderHeight, 0, headerHeight, labelWidth, tableHeaderHeight);
    context.drawImage(source, dateCropX, 0, dateCropWidth, tableHeaderHeight, labelWidth, headerHeight, dateCropWidth, tableHeaderHeight);
    let destinationY = headerHeight + tableHeaderHeight;
    bodySlices.forEach((slice) => {
      if (slice.kind === "route") {
        const route = routeGroups.find((candidate) => candidate.id === slice.routeId);
        context.fillStyle = "#f1f5f9";
        context.fillRect(0, destinationY, tableWidth, slice.height);
        context.strokeStyle = "#e2e8f0";
        context.lineWidth = Math.max(1, Math.round(sourceScaleY));
        context.beginPath();
        context.moveTo(0, destinationY + slice.height - context.lineWidth / 2);
        context.lineTo(tableWidth, destinationY + slice.height - context.lineWidth / 2);
        context.stroke();
        if (route) {
          const textX = Math.round(12 * sourceScaleX);
          context.textAlign = "left";
          context.textBaseline = "top";
          context.fillStyle = "#94a3b8";
          context.font = `600 ${Math.round(9 * sourceScaleY)}px sans-serif`;
          context.fillText(route.carrier, textX, destinationY + Math.round(6 * sourceScaleY), labelWidth - textX * 2);
          context.fillStyle = "#334155";
          context.font = `700 ${Math.round(11 * sourceScaleY)}px sans-serif`;
          context.fillText(route.name, textX, destinationY + Math.round(20 * sourceScaleY), labelWidth - textX * 2);
        }
        destinationY += slice.height;
        return;
      }
      context.drawImage(source, 0, slice.top, labelWidth, slice.height, 0, destinationY, labelWidth, slice.height);
      context.drawImage(source, dateCropX, slice.top, dateCropWidth, slice.height, labelWidth, destinationY, dateCropWidth, slice.height);
      destinationY += slice.height;
    });
    return output;
  };

  const refreshExportPreview = async (selection: ExportSelection) => {
    const generation = ++exportGenerationRef.current;
    setExportPreviewUrl(null);
    setExportBusy(true);
    setExportError("");
    exportArtifactsRef.current = null;
    try {
      const canvas = await buildExportCanvas(selection);
      const imageUrl = canvas.toDataURL("image/png");
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNGを作成できませんでした")), "image/png");
      });
      const range = exportDateRange(selection, laneWidth, dayWidth, dates);
      const filename = `シフトメモ_${range.start}${range.end === range.start ? "" : `_${range.end}`}`;
      const pdf = await pngToPdf(imageUrl, canvas.width, canvas.height);
      if (generation !== exportGenerationRef.current) return;
      exportArtifactsRef.current = { png, pdf, filename };
      setExportPreviewUrl(imageUrl);
    } catch (error) {
      if (generation !== exportGenerationRef.current) return;
      console.error(error);
      exportArtifactsRef.current = null;
      setExportPreviewUrl(null);
      setExportError("プレビューを作成できませんでした");
    } finally {
      if (generation === exportGenerationRef.current) setExportBusy(false);
    }
  };

  const selectExportHeader = (kind: "column" | "row" | "course", key: string) => {
    const range = exportRangeFromHeader(exportRows(), dates, laneWidth, dayWidth, {kind,key});
    if (!range) return;
    setExportSelection(range);
    void refreshExportPreview(range);
  };

  useEffect(() => {
    exportGenerationRef.current += 1;
    exportArtifactsRef.current = null;setExportPreviewUrl(null);setExportSelection(null);setExportBusy(false);
  },[dates,courses,assignments,lanes,laneOrder,routeOrder,hiddenLaneIds,hiddenRouteIds,backgroundColors,dayOverrides,requiredCountOverrides,dayWidth,laneWidth,drivers,extraPeople,hiddenPeople,shiftRequests]);

  const startExport = () => {
    stopExportAutoScroll();
    closeActivePanel(false);
    setSelectedToken(null);
    setExportMode(true);
    setExportSelection(null);
    setExportPreviewUrl(null);
    exportArtifactsRef.current = null;
    setExportError("");
  };

  const closeExport = () => {
    exportGenerationRef.current += 1;
    setExportBusy(false);
    stopExportAutoScroll();
    exportSelectionStartRef.current = null;
    setExportMode(false);
    setExportSelection(null);
    setExportPreviewUrl(null);
    exportArtifactsRef.current = null;
    setExportError("");
  };

  const selectWholeBoard = () => {
    const rows = exportRows();
    if (rows.length === 0) return;
    const selection: ExportSelection = {
      x: laneWidth,
      y: rows[0].top,
      width: dayWidth * dates.length,
      height: rows.at(-1)!.bottom - rows[0].top,
      routeIds: Array.from(new Set(rows.map((row) => row.routeId).filter(Boolean))),
      laneIds: rows.map((row) => row.laneId),
    };
    setExportSelection(selection);
    void refreshExportPreview(selection);
  };

  const downloadExport = (format: "png" | "pdf") => {
    const artifacts = exportArtifactsRef.current;
    if (!artifacts) {
      setExportError("先にプレビューを作成してください");
      return;
    }
    setExportError("");
    const objectUrl = URL.createObjectURL(artifacts[format]);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${artifacts.filename}.${format}`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  };

  const duplicateLaneNames = (token: PersonToken, targetKey: string): string[] => {
    const date = targetKey.split("|").at(-1) ?? "";
    return orderedLanes
      .filter((lane) => {
        const key = cellKey(lane.id, date);
        return (assignments[key] ?? []).some((person) =>
          person.personKey === token.personKey && person.placementId !== token.placementId,
        );
      })
      .map((lane) => lane.name);
  };

  const applyPersonDrop = (token: PersonToken, targetKey: string) => {
    if (token.sourceKey === targetKey) return;
    setAssignments((current) => {
      const next = { ...current };
      let moving: AssignedPerson | undefined;
      if (token.sourceKey && token.placementId) {
        moving = (next[token.sourceKey] ?? []).find((person) => person.placementId === token.placementId);
        next[token.sourceKey] = (next[token.sourceKey] ?? []).filter((person) => person.placementId !== token.placementId);
      }
      const person = moving ?? {
        placementId: newId("person"),
        personKey: token.personKey,
        driverId: token.driverId,
        name: token.name,
      };
      next[targetKey] = [...(next[targetKey] ?? []), person];
      return next;
    });
    setSelectedToken(null);
    setLiveMessage(`${token.name}を配置しました`);
  };

  const requestPlacement = (token: PersonToken, targetKey: string) => {
    if (token.sourceKey === targetKey) return;
    const existingNames = duplicateLaneNames(token, targetKey);
    if (existingNames.length > 0) {
      setPendingDuplicate({ token, targetKey, existingNames });
      setSelectedToken(null);
      return;
    }
    applyPersonDrop(token, targetKey);
  };

  const dropPerson = (event: DragEvent, targetKey: string) => {
    const raw = event.dataTransfer.getData(PERSON_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    requestPlacement(JSON.parse(raw) as PersonToken, targetKey);
  };

  const removePerson = (sourceKey: string, placementId: string, name: string) => {
    setAssignments((current) => ({
      ...current,
      [sourceKey]: (current[sourceKey] ?? []).filter((person) => person.placementId !== placementId),
    }));
    setSelectedToken(null);
    setLiveMessage(`${name}の配置を解除しました`);
  };

  const returnPersonToRack = (event: DragEvent) => {
    const raw = event.dataTransfer.getData(PERSON_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    const token = JSON.parse(raw) as PersonToken;
    if (token.sourceKey && token.placementId) removePerson(token.sourceKey, token.placementId, token.name);
  };

  const hideCandidate = (personKey: string) => {
    const candidate = candidates.find(token => token.personKey === personKey);
    if (!editable || !candidate) return;
    setHiddenPeople(current => ({ ...current, [personKey]: true }));
    setSelectedToken(current => current?.personKey === personKey && !current.sourceKey ? null : current);
    setLiveMessage(`${candidate.name}を名前札から非表示にしました。配置済みの札は残っています`);
  };
  const dropHiddenCandidate = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (!editable) return;
    try {
      const token = JSON.parse(event.dataTransfer.getData(PERSON_DRAG_TYPE)) as PersonToken;
      if (typeof token?.personKey === "string") hideCandidate(token.personKey);
    } catch { /* 名前札以外のドロップは変更しない */ }
  };
  const restoreCandidate = (token: PersonToken) => {
    if (!editable) return;
    setHiddenPeople(current => { const next = { ...current }; delete next[token.personKey]; return next; });
    setLiveMessage(`${token.name}を名前札に戻しました`);
  };

  const selectToken = (token: PersonToken) => {
    const same = selectedToken?.personKey === token.personKey && selectedToken.placementId === token.placementId;
    setSelectedToken(same ? null : token);
    setLiveMessage(same ? `${token.name}の選択を解除しました` : `${token.name}を選択しました`);
  };

  /** 自分で作った文字札を名前札の棚から消す。置いてある札はそのまま残す */
  const removeCustomPerson = (name: string) => {
    setExtraPeople((current) => current.filter((value) => value !== name));
    setSelectedToken((current) => (current?.personKey === `custom:${name}` && !current.sourceKey ? null : current));
    setLiveMessage(`${name}の札を消しました`);
  };

  const addCustomPerson = () => {
    const name = customName.trim().slice(0, 20);
    if (!name) return;
    setExtraPeople((current) => current.includes(name) ? current : [...current, name]);
    setCustomName("");
  };

  const addLane = (route: RouteGroup) => {
    const name = newLaneName.trim().slice(0, 30);
    if (!name) return;
    const lane: AssignmentLane = {
      id: newId(`lane-${route.id}`),
      routeId: route.id,
      name,
      color: route.color,
      activeWeekdays: [...MON_TO_SAT],
      requiredCount: route.defaultRequiredCount,
      custom: true,
    };
    setLanes((current) => [...current, lane]);
    setLaneOrder((current) => [...current, lane.id]);
    setNewLaneName("");
    closeActivePanel(true);
  };

  const openAddLane = (route: RouteGroup, event: ReactMouseEvent<HTMLButtonElement>) => {
    activePanelTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setNewLaneName("");
    setActivePanel({ kind: "add", routeId: route.id, anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } });
  };

  const openLaneSettings = (lane: AssignmentLane, event: ReactMouseEvent<HTMLButtonElement>) => {
    activePanelTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setSettingsName(lane.name);
    setSettingsWeekdays([...lane.activeWeekdays]);
    setSettingsRequiredCount(lane.requiredCount);
    setActivePanel({ kind: "edit", laneId: lane.id, anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } });
  };

  const openDailyRequiredCount = (lane: AssignmentLane, date: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    activePanelTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setActivePanel({ kind: "required", laneId: lane.id, date, anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } });
  };

  const changeCellRequiredCount = (lane: AssignmentLane, date: string, delta: number | null) => {
    const key = cellKey(lane.id, date);
    setRequiredCountOverrides((current) => {
      const count = current[key] ?? lane.requiredCount;
      return updateRequiredCountOverride(current, key, lane.requiredCount, delta === null ? null : Math.max(0, Math.min(MAX_REQUIRED_COUNT, count + delta)));
    });
  };

  const changeDailyRequiredCount = (delta: number | null) => {
    if (activePanel?.kind !== "required" || !requiredLane) return;
    changeCellRequiredCount(requiredLane, activePanel.date, delta);
  };

  const saveLaneSettings = (laneId: string) => {
    const name = settingsName.trim().slice(0, 30);
    if (!name || settingsWeekdays.length === 0) return;
    setLanes((current) => current.map((lane) => lane.id === laneId ? {
      ...lane,
      name,
      activeWeekdays: [...settingsWeekdays].sort((a, b) => a - b),
      requiredCount: Math.max(0, Math.min(10, settingsRequiredCount)),
    } : lane));
    closeActivePanel(true);
  };

  const reorderLane = (sourceId: string, targetId: string) => {
    const source = lanes.find((lane) => lane.id === sourceId);
    const target = lanes.find((lane) => lane.id === targetId);
    if (!source || !target || source.routeId !== target.routeId || sourceId === targetId) return;
    setLaneOrder((current) => {
      const next = current.filter((id) => id !== sourceId);
      next.splice(next.indexOf(targetId), 0, sourceId);
      return next;
    });
  };

  const selectedAssignments = selectedDate
    ? visibleLanes.filter(lane => selection?.kind !== "cell" || lane.id === selection.laneId).map((lane) => ({ lane, people: assignments[cellKey(lane.id, selectedDate)] ?? [] }))
    : [];
  const selectedShortages = selectedDate
    ? selectedAssignments
        .map((entry) => ({ ...entry, shortage: shortageFor(entry.lane, selectedDate, entry.people) }))
        .filter((entry) => entry.shortage > 0)
    : [];
  const dayShortage = (date: string) => visibleLanes.reduce((sum, lane) => {
    const people = assignments[cellKey(lane.id, date)] ?? [];
    return sum + shortageFor(lane, date, people);
  }, 0);

  const describeSharedValue = (field: string, value: unknown) => field === "backgroundColors" ? MEMO_BACKGROUND_COLORS.find(item => item.value === value)?.label ?? "指定なし" : shared.describe(value);

  if (!boardHydrated) {
    return <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />;
  }

  return (
    <div ref={rootRef} data-testid="memo-file-drop"
      onDragEnterCapture={event => { if (isFileDrag(event)) { event.preventDefault(); event.stopPropagation(); fileDragDepth.current++; setFileDragOver(true); } }}
      onDragLeaveCapture={event => { if (isFileDrag(event)) { fileDragDepth.current = Math.max(0,fileDragDepth.current-1); if (!fileDragDepth.current) setFileDragOver(false); } }}
      onDragOverCapture={event => { if (isFileDrag(event)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = mode === "personal" && !imageReadBusy && !exportMode ? "copy" : "none"; } }}
      onDropCapture={dropMemoFile}
      onFocusCapture={(event) => { if (mode === "shared" && !(event.target as Element).closest("[data-shared-cell], #shift-memo-notes")) cursors.reportCell(null); }}
      onBlurCapture={(event) => { if (mode === "shared" && !event.currentTarget.contains(event.relatedTarget as Node | null)) cursors.reportCell(null); }}
      onClickCapture={(event) => { if (mode === "shared" && !canEdit && !(event.target as Element).closest("[data-shared-refresh]")) { event.preventDefault(); event.stopPropagation(); } }}
      onKeyDownCapture={(event) => { if (mode === "shared" && !canEdit && (event.key === "Enter" || event.key === " ") && !(event.target as Element).closest("[data-shared-refresh]")) { event.preventDefault(); event.stopPropagation(); } }}
      onBeforeInputCapture={(event) => { if (mode === "shared" && !canEdit) event.preventDefault(); }}
      onDragStartCapture={(event) => { if (mode === "shared" && !canEdit) event.preventDefault(); }}
      className={cn("space-y-2 pb-8 text-slate-900", mode === "shared" && !canEdit && "[&_button]:pointer-events-none [&_input]:pointer-events-none [&_textarea]:pointer-events-none")}>
      <p className="sr-only" aria-live="polite">{liveMessage}</p>
      {mode === "shared" && shared.conflict && <section role="region" aria-label="共有メモの変更を確認" className="break-words rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700">
        <p>別の変更と重なっています。更新しても入力は残ります。今回の変更をまとめて選んでください。</p>
        <ul className="mt-2 space-y-1">{shared.conflicts.map(change => <li key={`${change.field}:${change.key ?? ""}`}>
          {change.field === "notes" && change.key ? `${dateInfo(change.key).monthDay}のメモ` : change.field === "assignments" ? "名前札の配置" : change.field === "hiddenPeople" ? "候補の名前札の表示" : change.field === "backgroundColors" ? "背景色" : "担当枠の設定"}:
          <span className="ml-1">自分「{describeSharedValue(change.field,change.value)}」／共有「{describeSharedValue(change.field,shared.remoteValue(change))}」</span>
        </li>)}</ul>
        {canEdit && <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => shared.resolve(true)} className="min-h-11 rounded-lg bg-slate-900 px-3 font-semibold text-white">自分の変更を保存</button>
          <button type="button" onClick={() => { if (window.confirm("今回の未保存の変更を取り消して、共有の内容を使いますか？")) shared.resolve(false); }} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-semibold">共有の内容を使う</button>
        </div>}
      </section>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-slate-50 py-1">
        {toolbarLeading}
        {!toolbarLeading && <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
          <FontAwesomeIcon icon={faLock} className="h-3 w-3" />{mode === "shared" ? "共有メモ" : "個人メモ"}
        </span>}
        {mode === "shared" && cursors.peers.length > 0 && <span className="text-[11px] text-slate-600">参加中: {cursors.peers.map((peer) => peer.name).join("、")}</span>}
        {canReflect && onReflected && <button type="button" disabled={!boardHydrated || exportMode} onClick={() => setReflectOpen(true)} className="min-h-11 rounded-lg bg-slate-900 px-2.5 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-40">シフトへ反映</button>}
        {mode === "personal" && <>
          <input ref={transferInputRef} type="file" accept=".json,application/json,.png,image/png,.pdf,application/pdf" className="sr-only" aria-label="読み込むシフトメモを選ぶ" onChange={(event) => void receiveMemoData(event.target.files?.[0])}/>
          {backupAvailable && <button type="button" onClick={() => setRestorePending(true)} className="min-h-11 px-2 text-[11px] font-semibold text-slate-600 underline underline-offset-2">読み込み前に戻す</button>}
        </>}
        <span className={cn("text-[11px] text-slate-500", toolbarLeading && !displaySaveError && !(mode === "shared" && (shared.pending || shared.slow)) && "max-sm:sr-only")} role="status">
          {displaySaveError ? <span role="alert" className="text-rose-600">{displaySaveError}
            {!shared.conflict && <button type="button" data-shared-refresh style={{ pointerEvents: "auto" }}
              onClick={() => mode === "shared" ? shared.refresh() : setSaveRevision(value => value + 1)}
              className="ml-2 min-h-11 underline underline-offset-2">{mode === "shared" ? "同期を再試行" : "保存を再試行"}</button>}
          </span> : mode === "shared" ? shared.saving ? shared.slow ? <span className="text-amber-700">保存に時間がかかっています。入力は残っています</span> : "保存中" : shared.pending ? "未同期" : shared.syncing ? "同期を確認中" : "同期済み"
            : savedAt ? toolbarLeading ? "保存済み" : "この端末に自動保存済み" : toolbarLeading ? "保存待ち" : "この端末に保存"}
          {mode === "shared" && !cursors.connected && <span className="ml-2">再接続中</span>}
        </span>
        {mode === "shared" && <button type="button" data-shared-refresh style={{ pointerEvents: "auto" }} disabled={shared.syncing}
          onClick={shared.refresh}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
          <FontAwesomeIcon icon={faRotateLeft} className="h-3 w-3" />更新
        </button>}

        <button
          type="button"
          onClick={exportMode ? closeExport : startExport}
          aria-pressed={exportMode}
          aria-label={exportMode ? "選択を終了" : "エクスポート"}
          className={cn(
            "ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold transition",
            exportMode
              ? "border-amber-400 bg-amber-50 text-amber-800"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
          )}
        >
          <FontAwesomeIcon icon={exportMode ? faXmark : faDownload} className="h-3 w-3" />
          <span className="hidden sm:inline">{exportMode ? "選択を終了" : "エクスポート"}</span>
        </button>
        <Popover open={moreOpen} onOpenChange={setMoreOpen}><PopoverTrigger asChild><button type="button" data-shared-refresh style={{pointerEvents:"auto"}} aria-label="その他の操作" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><FontAwesomeIcon icon={faEllipsis}/></button></PopoverTrigger>
          <PopoverContent align="end" data-memo-popover className="flex w-48 flex-col gap-1 p-2">
            {mode === "personal" && (<button type="button" disabled={!boardHydrated || imageReadBusy || exportMode} onClick={() => {setMoreOpen(false);transferInputRef.current?.click();}} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            <FontAwesomeIcon icon={faFileImport} className="h-3 w-3" />{imageReadBusy ? "読み取り中" : "読み込む"}
          </button>)}
        <button type="button" data-shared-refresh style={{pointerEvents:"auto"}} aria-expanded={workDaysOpen} aria-controls="memo-work-days" onClick={() => {setWorkDaysOpen(open => !open);setMoreOpen(false);}} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold">稼働日数</button>
          </PopoverContent>
        </Popover>
        {hiddenLanes.length + hiddenRoutes.length > 0 && (
          <button type="button" onClick={() => setHiddenOpen((open) => !open)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600 hover:border-slate-400">
            <FontAwesomeIcon icon={faEye} className="h-3 w-3" />非表示 {hiddenLanes.length + hiddenRoutes.length}件
            <FontAwesomeIcon icon={faChevronDown} className={cn("h-2.5 w-2.5 transition-transform", hiddenOpen && "rotate-180")} />
          </button>
        )}
      </div>


      <SmoothCollapse open={!!selection && editable && !exportMode} id="memo-selection-workspace" speed="quick">
        <section aria-label="選択範囲の操作" onKeyDown={event => {if(event.key === "Escape") setSelection(null);}} className="grid grid-cols-[minmax(0,1fr)_auto_auto_2.75rem] items-center gap-x-2 rounded-lg bg-slate-100/60 px-2 py-0.5 lg:grid-cols-[15rem_7rem_minmax(0,1fr)_2.75rem]">
          <h3 aria-label={selectionLabel} className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-800">
            {selectionCourse ? <>
              <CourseChip name={selectionCourse.name} color={selectionCourse.color} truncate />
              {selectedLane && selectedLane.name !== selectionCourse.name && <span title={selectedLane.name} className="max-w-[50%] shrink-0 truncate">{selectedLane.name}</span>}
            </> : <span className="truncate">{selection?.kind === "column" ? `${dateInfo(selection.date).monthDay}（${dateInfo(selection.date).weekday}）` : selectionLabel}</span>}
          </h3>
          <span className="col-start-2 row-start-1 whitespace-nowrap text-[11px] font-medium tabular-nums text-slate-600">
            {selection?.kind === "cell" ? `${dateInfo(selection.date).monthDay}（${dateInfo(selection.date).weekday}）` : selection?.kind === "row" ? `${dates.length}日分` : selection?.kind === "column" ? "1列" : ""}
          </span>
          <div className={cn("col-span-4 row-start-2 flex min-h-11 items-center gap-2 lg:gap-4 lg:col-span-1 lg:col-start-3 lg:row-start-1", selection?.kind === "column" && "col-span-1 col-start-3 row-start-1")}>
            {selection?.kind === "cell" && selectedLane && <>
              <button type="button" role="switch" aria-label="稼働" aria-checked={activeOn(selectedLane, selection.date)} onClick={() => toggleDayActivity(selectedLane, selection.date)} className="inline-flex min-h-11 w-16 shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                <span aria-hidden="true" className={cn("relative h-4 w-7 shrink-0 rounded-full", activeOn(selectedLane, selection.date) ? "bg-slate-600" : "bg-slate-300")}><span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white", activeOn(selectedLane, selection.date) ? "left-3.5" : "left-0.5")} /></span>
                <span className="w-6">{activeOn(selectedLane, selection.date) ? "稼働" : "休み"}</span>
              </button>
              <div role="group" aria-label="必要人数" className="inline-flex shrink-0 items-center">
                <span className="text-xs text-slate-500">必要</span>
                <button type="button" aria-label="必要人数を減らす" disabled={selectedCellRequiredCount === 0} onClick={() => changeCellRequiredCount(selectedLane, selection.date, -1)} className="inline-flex min-h-11 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 disabled:opacity-30"><FontAwesomeIcon icon={faMinus} className="h-2.5 w-2.5" /></button>
                <output aria-label="この日の必要人数" aria-live="polite" className="w-8 whitespace-nowrap text-center text-xs font-semibold tabular-nums text-slate-800">{selectedCellRequiredCount}人</output>
                <button type="button" aria-label="必要人数を増やす" disabled={selectedCellRequiredCount === MAX_REQUIRED_COUNT} onClick={() => changeCellRequiredCount(selectedLane, selection.date, 1)} className="inline-flex min-h-11 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 disabled:opacity-30"><FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" /></button>
              </div>
            </>}
            {selection?.kind === "row" && selectedLane && <button type="button" onClick={event => openLaneSettings(selectedLane,event)} className="min-h-11 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-200/50">担当枠の設定</button>}
            {selection?.kind === "course" && selectedRoute && <button type="button" onClick={event => openAddLane(selectedRoute,event)} className="min-h-11 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-200/50">担当枠を追加</button>}
          <Popover><PopoverTrigger asChild><button type="button" aria-label="塗りつぶし" className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-md text-xs text-slate-500 hover:bg-slate-200/50 hover:text-slate-700"><FontAwesomeIcon icon={faFillDrip}/></button></PopoverTrigger>
            <PopoverContent align="start" data-memo-popover className="w-[296px] max-w-[calc(100vw-24px)] space-y-2 p-2">
          <div role="group" aria-label="背景の色" className="grid grid-cols-6 gap-px">{MEMO_BACKGROUND_COLORS.map(item => <button type="button" key={item.value} aria-label={`背景色を${item.label}にする`} aria-pressed={!!colorKey && backgroundColors[colorKey] === item.value} onClick={() => changeBackground(item.value)} className={cn("min-h-11 min-w-11 rounded-md border px-0.5 text-[11px] font-semibold text-slate-700",colorKey && backgroundColors[colorKey] === item.value ? "border-slate-800 ring-1 ring-slate-800" : "border-slate-200")} style={{backgroundColor:item.color}} title={item.label}>{item.value === "none" ? <FontAwesomeIcon icon={faSlash} className="text-red-500" style={{width:24,height:24}} /> : item.label}</button>)}</div>
          {selection?.kind === "column" && <CheckboxField label={`毎週${dateInfo(selection.date).weekday}曜日`} checked={colorScope === "weekday"} onCheckedChange={checked => setColorScope(checked ? "weekday" : "date")}/>}
            </PopoverContent>
          </Popover>
          </div>
          <button type="button" aria-label="選択を解除" onClick={() => setSelection(null)} className="col-start-4 row-start-1 inline-flex min-h-11 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/50 hover:text-slate-700"><FontAwesomeIcon icon={faXmark}/></button>
        </section>
      </SmoothCollapse>
      <SmoothCollapse id="memo-work-days" open={workDaysOpen}>
        <section aria-label="表示期間の稼働日数" className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold text-slate-500">{exportPeriodLabel(dates)}・全コース</h3>
          <ul className="flex flex-wrap gap-2">{workDayPeople.map(person => <li key={person.personKey} className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs"><span>{person.name}</span><span className="font-bold tabular-nums">{workDays.get(person.personKey)?.days ?? 0}日</span></li>)}</ul>
        </section>
      </SmoothCollapse>
      {transferError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{transferError}{failedReadFile && <button type="button" onClick={() => void receiveMemoData(failedReadFile)} className="ml-3 min-h-11 font-semibold underline underline-offset-2">読み直す</button>}</p>}
      <ConfirmDialog open={!!pendingTransfer} title="この端末のメモを置き換えますか？"
        message={pendingTransfer ? `${pendingTransfer.fileName}\n担当枠 ${pendingTransfer.board.lanes.length}件・配置 ${pendingTransfer.placementCount}件${pendingTransfer.unregisteredNames.length ? `\n未登録の名前札 ${pendingTransfer.unregisteredNames.length}人はメモに残ります。` : ""}\n読み込み前のメモには戻せます。` : ""}
        confirmLabel="メモを読み込む" tone="neutral" onConfirm={applyReceivedMemo} onClose={() => setPendingTransfer(null)}/>
      <ConfirmDialog open={restorePending} title="読み込み前のメモに戻しますか？"
        message="読み込み後の変更は失われます。" confirmLabel="読み込み前に戻す" tone="danger" onConfirm={restoreBeforeImport} onClose={() => setRestorePending(false)}/>
      {fileDragOver && <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4"><div className="rounded-xl border-2 border-dashed border-slate-400 bg-white px-8 py-10 text-center text-sm font-semibold text-slate-800"><FontAwesomeIcon icon={faFileImport} className="mb-3 text-slate-500" /><p>{mode !== "personal" ? "個人メモで読み込んでください" : imageReadBusy ? "読み取り中です" : exportMode ? "エクスポートを終了してください" : "ここにドロップして読み込む"}</p></div></div>}
      {imageReadBusy && <MemoReadProgressDialog fileName={readingFileName} onCancel={cancelImageRead}/>}
      {pendingImage && <ImageMemoImportDialog file={pendingImage.file} read={pendingImage.read} lanes={lanes} courses={courses}
        drivers={drivers} dayOverrides={dayOverrides} dayOffByDate={dayOffByDate} error={transferError}
        targets={pendingImage.targets} onTargetChange={(index, target) => { setTransferError(""); setPendingImage(current => current ? { ...current, targets: current.targets.map((value, i) => i === index ? target : value) } : null); }}
        onClose={() => setPendingImage(null)} onConfirm={applyImageMemo}/>}

      {reflectOpen && onReflected && <ReflectShiftMemoDialog dates={dates} courses={courses} drivers={drivers}
        lanes={lanes.filter(lane => courses.some(course => course.id === lane.routeId))} assignments={assignments} dayOverrides={dayOverrides}
        onClose={() => setReflectOpen(false)} onApplied={onReflected}
        onActivateDay={(laneId,date) => setDayOverrides(current => ({ ...current, [cellKey(laneId,date)]: "on" }))}
        onLaneTargetChange={(laneId, courseId) => setLanes(current => current.map(lane => lane.id === laneId ? { ...lane, reflectCourseId: courseId } : lane))}/>}

      {hiddenOpen && hiddenLanes.length + hiddenRoutes.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          {hiddenRoutes.map((route) => (
            <button key={route.id} type="button" onClick={() => setHiddenRouteIds((ids) => ids.filter((id) => id !== route.id))} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 text-[10px] font-bold text-slate-700 hover:border-amber-500" title={`${route.name}を表示に戻す`}>
              <FontAwesomeIcon icon={faTruck} className="h-2.5 w-2.5 text-slate-400" />{route.name}
              <FontAwesomeIcon icon={faRotateLeft} className="h-2.5 w-2.5 text-amber-600" />
            </button>
          ))}
          {hiddenLanes.map((lane) => (
            <button key={lane.id} type="button" onClick={() => setHiddenLaneIds((ids) => ids.filter((id) => id !== lane.id))} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2 text-[10px] font-medium text-slate-700 hover:border-amber-400">
              <span className="h-3 w-1 rounded-full" style={{ backgroundColor: lane.color }} />{lane.name}
              <FontAwesomeIcon icon={faRotateLeft} className="h-2.5 w-2.5 text-amber-600" />
            </button>
          ))}
          <button type="button" onClick={() => { setHiddenLaneIds([]); setHiddenRouteIds([]); }} className="ml-auto text-[10px] font-medium text-amber-700 hover:underline">すべて表示へ戻す</button>
        </section>
      )}

      <div
        inert={activePanel !== null || pendingDuplicate !== null || reflectOpen || imageReadBusy || pendingImage !== null ? true : undefined}
        aria-hidden={activePanel !== null || pendingDuplicate !== null || reflectOpen || imageReadBusy || pendingImage !== null ? true : undefined}
        className="grid min-h-[680px] overflow-hidden rounded-xl border border-slate-200/60 bg-white lg:h-[calc(100dvh-250px)] lg:grid-cols-[minmax(0,1fr)_7px_var(--memo-detail-width)]"
        style={{ "--memo-detail-width": `${detailWidth}px` } as React.CSSProperties}
      >
        <section ref={boardScrollerRef} data-shift-export-scroller="true" className="min-h-[480px] min-w-0 overflow-auto bg-white lg:min-h-0">
          <div ref={boardRef} className="relative grid min-h-full content-start" style={{ gridTemplateColumns: `${laneWidth}px repeat(${dates.length}, ${dayWidth}px)`, width: boardWidth }}>
            <div data-shift-export-sticky="true" data-memo-grid="true" style={memoGridStyle(false)} className="sticky left-0 top-0 z-50 flex h-16 items-center bg-slate-50 px-3">
              <span className="text-xs font-bold text-slate-600">町名・担当枠</span>
              <button data-html2canvas-ignore="true" type="button" onPointerDown={(event) => startResize(event, laneWidth, setLaneWidth, 150, 300)} className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-indigo-200/70" aria-label={`担当枠列の幅を変更（現在${laneWidth}px）`} />
            </div>
            {dates.map((date) => {
              const info = dateInfo(date);
              const shortage = dayShortage(date);
              return (
                <div key={date} data-memo-grid="true" style={{backgroundColor:memoBackgroundColor(backgroundColors,date), ...memoGridStyle(isColumnSelected(date),{top:true,left:true,right:true})}} data-shift-export-sticky="true" data-shift-export-selected={isColumnSelected(date) ? "true" : undefined} className={cn("sticky top-0 z-40 h-16 bg-slate-50 text-xs font-bold", isColumnSelected(date) && "text-indigo-700", selectedDate !== date && info.weekdayNo === 6 && "text-blue-600", selectedDate !== date && info.weekdayNo === 0 && "text-rose-600")}>
                  <button data-shift-export-day="true" type="button" aria-pressed={isColumnSelected(date)} onClick={() => selectColumn(date)} className="flex h-full w-full flex-col items-center justify-center">
                    <span data-shift-export-day-number="true" className="text-sm">{info.day}日</span><span data-shift-export-day-weekday="true" className="text-[10px]">（{info.weekday}）</span>
                    {shortage > 0 && <span data-shift-export-pill="true" data-shift-export-day-shortage={date} className="mt-0.5 rounded-full bg-amber-100 px-1.5 text-[8px] font-bold leading-4 text-amber-700">不足{shortage}</span>}
                  </button>
                  <button data-html2canvas-ignore="true" type="button" onPointerDown={(event) => startResize(event, dayWidth, setDayWidth, 56, 140)} className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize" aria-label={`日付列の幅を変更（現在${dayWidth}px）`} />
                </div>
              );
            })}

            {visibleRoutes.map((route) => {
              const routeLanes = visibleLanes.filter((lane) => lane.routeId === route.id);
              return (
                <div key={route.id} className="contents">
                  <div
                    data-export-route-header={route.id}
                    data-memo-grid="true"
                    style={memoGridStyle(isCourseSelected(route.id),{top:true,left:true,bottom:routeLanes.length === 0})}
                    data-shift-export-selected={isCourseSelected(route.id) ? "true" : undefined}
                    data-shift-export-sticky="true"
                    className={cn(
                      "sticky left-0 z-30 flex h-11 items-center gap-2 bg-slate-100 px-3",
                      exportMode && exportSelection?.routeIds.includes(route.id) && "border-l-2 border-l-amber-500 bg-amber-50",
                    )}
                  >
                    <FontAwesomeIcon icon={faTruck} className="h-3 w-3 shrink-0 text-slate-400" />
                    <button type="button" aria-label={`${route.name}の行を選択`} aria-pressed={isCourseSelected(route.id)} onClick={() => selectCourse(route.id)} className="min-h-11 min-w-0 flex-1 text-left leading-tight"><span className="block truncate text-[9px] text-slate-400">{route.carrier}</span><span className="block truncate text-xs font-bold text-slate-700">{route.name}</span></button>
                    <button data-html2canvas-ignore="true" type="button" onClick={() => moveRouteToTop(route.id)} disabled={visibleRoutes[0]?.id === route.id} className="inline-flex h-7 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent" aria-label={`${route.name}を一番上へ`} title="一番上へ"><FontAwesomeIcon icon={faArrowUp} className="h-3 w-3" /></button>
                    <button data-html2canvas-ignore="true" type="button" onClick={() => setHiddenRouteIds((ids) => ids.includes(route.id) ? ids : [...ids, route.id])} className="inline-flex h-7 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`${route.name}を非表示にする`} title="このコースを非表示"><FontAwesomeIcon icon={faEyeSlash} className="h-3 w-3" /></button>
                    <button data-html2canvas-ignore="true" type="button" data-route-add={route.id} onClick={(event) => openAddLane(route, event)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`${route.name}に担当枠を追加`} aria-haspopup="dialog"><FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /></button>
                  </div>
                  {dates.map((date) => {
                    const selected = !exportMode && (isCourseSelected(route.id) || isColumnSelected(date));
                    return <div key={date} data-memo-grid="true" data-shift-export-selected={selected ? "true" : undefined} className="h-11 bg-slate-100/80" style={memoGridStyle(selected, {top:selection?.kind === "course",left:selection?.kind === "column",right:selection?.kind === "column" || date === dates.at(-1),bottom:routeLanes.length === 0 && selection?.kind === "course"})} />;
                  })}

                  {routeLanes.map((lane) => (
                    <div key={lane.id} className="contents">
                      <div
                        data-export-row={lane.id}
                        data-memo-grid="true"
                        data-shift-export-selected={isRowSelected(lane) ? "true" : undefined}
                        style={{backgroundColor:memoBackgroundColor(backgroundColors,undefined,lane.id,lane.routeId), ...memoGridStyle(isRowSelected(lane),{left:true,top:selection?.kind === "row",bottom:selection?.kind === "row" || lane.id === routeLanes.at(-1)?.id})}}
                        data-export-route-id={lane.routeId}
                        data-shift-export-sticky="true"
                        draggable={!exportMode}
                        onDragStart={(event) => event.dataTransfer.setData(LANE_DRAG_TYPE, lane.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => reorderLane(event.dataTransfer.getData(LANE_DRAG_TYPE), lane.id)}
                        className="sticky left-0 z-30 flex min-h-28 items-center gap-2 bg-white px-2.5"
                      >
                        <span data-export-row-label="true" className="absolute left-3 right-3 top-2 hidden truncate text-[9px] font-medium text-slate-500">{route.name}</span>
                        <span data-html2canvas-ignore="true" className="inline-flex"><FontAwesomeIcon icon={faGripLines} className="h-3 w-3 shrink-0 cursor-grab text-slate-300" /></span>
                        <span className="h-12 w-1 shrink-0 rounded-full" style={{ backgroundColor: lane.color }} />
                        <button type="button" aria-label={`${laneLabel(lane)}の行を選択`} aria-pressed={isRowSelected(lane)} onClick={() => selectRow(lane.id)} className="min-h-11 min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-500"><div data-export-row-name={route.name === lane.name ? "duplicate" : "distinct"} className="text-xs font-bold leading-snug text-slate-700">{lane.name}</div><div className="mt-1 text-[9px] text-slate-400">{weekdaySummary(lane.activeWeekdays)}・{lane.requiredCount}人</div></button>
                        <button data-html2canvas-ignore="true" type="button" onClick={(event) => openLaneSettings(lane, event)} className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 hover:text-slate-700" aria-label={`${lane.name}を編集`} aria-haspopup="dialog"><FontAwesomeIcon icon={faEllipsis} className="h-3 w-3" /></button>
                      </div>
                      {dates.map((date) => {
                        const key = cellKey(lane.id, date);
                        const people = assignments[key] ?? [];
                        const activity = dayActivity(lane, date);
                        const active = activity.active;
                        const { shortage, requiredCount } = staffingOn(lane, date, people);
                        const hasRequiredOverride = requiredCountOverrides[key] !== undefined;
                        const offToday = dayOffByDate.get(date);
                        return (
                          <div
                            key={key}
                            role="group"
                            data-memo-grid="true"
                            data-shift-export-selected={isCellSelected(lane,date) ? "true" : undefined}
                            aria-label={`${laneLabel(lane)}・${dateInfo(date).monthDay}のセル`}
                            aria-description={isCellSelected(lane,date) ? "選択中" : undefined}
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.target === event.currentTarget && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) {
                                event.preventDefault();
                                const nextDate = dates[dates.indexOf(date) + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0)];
                                const nextLane = visibleLanes[visibleLanes.findIndex(item => item.id === lane.id) + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0)];
                                if(nextDate && nextLane) {
                                  selectCell(nextLane.id,nextDate);
                                  const target = Array.from(boardRef.current?.querySelectorAll<HTMLElement>("[data-shared-cell]") ?? []).find(item => item.dataset.sharedCell === cellKey(nextLane.id,nextDate));
                                  target?.focus();
                                }
                              }
                              if (event.target === event.currentTarget && event.key === "Escape") setSelection(null);
                              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) selectCell(lane.id,date);
                              if (event.target === event.currentTarget && active && selectedToken && (event.key === "Enter" || event.key === " ")) {
                                event.preventDefault();
                                requestPlacement(selectedToken, key);
                              }
                            }}
                            onDragOver={(event) => { if (active) event.preventDefault(); }}
                            onDrop={(event) => { if (active) dropPerson(event, key); }}
                            data-shared-cell={key}
                            onClick={() => { selectCell(lane.id,date); if (mode === "shared") cursors.reportCell(key); }}
                            onFocus={() => { if (mode === "shared") cursors.reportCell(key); }}
                            className={cn("group relative flex min-h-28 flex-col content-start items-start gap-1.5 p-1.5 outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-500 focus-visible:-outline-offset-2", dayWidth < 72 ? "pt-12" : "pt-7", active ? "hover:bg-slate-50" : "bg-slate-100/80")}
                            // その日だけの指定で動かしている枠は破線で囲む（曜日どおりの枠と見分ける）
                            title={activity.spot ? (active ? "この日だけ稼働にしています" : "この日だけ休みにしています") : undefined}
                            style={{
                              backgroundColor: memoBackgroundColor(backgroundColors,date,lane.id,lane.routeId),
                              ...memoGridStyle(isCellSelected(lane,date), {
                                top: selection?.kind === "cell" || selection?.kind === "row",
                                bottom: selection?.kind === "cell" || selection?.kind === "row" || (selection?.kind === "course" ? lane.id === routeLanes.at(-1)?.id : false),
                                left: selection?.kind === "cell" || selection?.kind === "column",
                                right: selection?.kind === "cell" || selection?.kind === "column" || date === dates.at(-1),
                              }),
                              ...(active ? {} : { backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(148,163,184,0.08) 8px, rgba(148,163,184,0.08) 10px)" }),
                              ...(activity.spot ? { outline: "1px dashed #64748b", outlineOffset: "-3px" } : {}),
                            }}
                          >
                            {mode === "shared" && <div data-html2canvas-ignore="true" className="pointer-events-none absolute right-0.5 top-0.5 z-20 flex max-w-full flex-wrap justify-end gap-0.5">{cursors.cellPeers[key]?.map(peer => <span key={peer.id} className="rounded px-1 text-[9px] font-bold text-white" style={{ backgroundColor: peer.color }}>{peer.name}</span>)}</div>}
                            {/* このコースのこの日を休みにする／戻す。日付を選ばなくても押せる */}
                            <button
                              data-html2canvas-ignore="true"
                              type="button"
                              onClick={(event) => { event.stopPropagation(); toggleDayActivity(lane, date); }}
                              title={`${dateInfo(date).monthDay}の${lane.name}を${active ? "休みにする" : "稼働にする"}`}
                              aria-label={`${dateInfo(date).monthDay}の${lane.name}を${active ? "休みにする" : "稼働にする"}`}
                              className={cn(
                                "absolute left-1 z-10 inline-flex h-5 w-7 items-center justify-center rounded border px-1 text-[9px] font-bold leading-none transition-opacity [@media(hover:none)]:opacity-60",
                                dayWidth < 72 ? "top-7" : "top-1",
                                active
                                  ? "border-slate-200 bg-white text-slate-400 opacity-0 hover:border-rose-200 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                                  : "border-slate-300 bg-white/90 text-slate-600 opacity-0 hover:border-slate-500 hover:text-slate-900 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
                              )}
                            >
                              {active ? "休み" : "稼働"}
                            </button>
                            {active ? <button
                              type="button"
                              data-shift-required-trigger="true"
                              disabled={exportMode}
                              onClick={(event) => openDailyRequiredCount(lane, date, event)}
                              aria-label={`${dateInfo(date).monthDay}の${lane.name}の必要人数を変更（現在${requiredCount}人）`}
                              aria-haspopup="dialog"
                              title="この日だけの必要人数を変更"
                              className="absolute right-1 top-1 inline-flex h-5 min-w-8 items-center justify-center rounded hover:ring-1 hover:ring-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                            >{shortage > 0
                              ? <span data-shift-export-pill="true" className="rounded-full bg-amber-100 px-1 text-[9px] font-bold leading-4 text-amber-700">あと{shortage}</span>
                              : <span data-shift-export-meta="true" className="text-[9px] text-slate-500 underline decoration-slate-300 underline-offset-2">{assignedCount(people)}/{requiredCount}</span>}
                            </button> : <span data-shift-export-meta="true" className={cn("absolute right-1 top-1.5 text-[9px]", activity.spot ? "font-bold text-slate-600" : "text-slate-400")}>{activityLabel(activity)}</span>}
                            {people.map((person) => {
                              const token: PersonToken = { personKey: person.personKey, driverId: person.driverId, name: person.name, sourceKey: key, placementId: person.placementId };
                              return <PersonSlip key={person.placementId} token={token} dayOff={!!person.driverId && offToday?.has(person.driverId)} selected={selectedToken?.placementId === person.placementId} onSelect={() => {selectCell(lane.id,date);selectToken(token);}} onRemove={() => removePerson(key, person.placementId, person.name)} />;
                            })}
                            {active && people.length === 0 && <span className="m-auto text-base font-light text-slate-300">＋</span>}
                            {hasRequiredOverride && <span data-shift-export-meta="true" className="mt-auto self-end whitespace-nowrap text-[9px] text-slate-600">必要{requiredCount}人</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}

            <div data-export-row="unassigned" data-memo-grid="true" data-shift-export-sticky="true" style={memoGridStyle(false)} className="sticky left-0 z-30 flex min-h-28 items-start bg-slate-50 px-3 py-3">
              {exportMode ? <button type="button" aria-pressed={!!exportSelection?.laneIds.includes("unassigned")} onClick={() => selectExportHeader("row","unassigned")} className="min-h-11 w-full text-left text-xs font-bold text-slate-600">非稼働</button> : <span className="text-xs font-bold text-slate-600">非稼働</span>}
            </div>
            {dates.map(date => {
              const selected = !exportMode && isColumnSelected(date);
              const people = unassignedByDate.get(date) ?? [];
              return <div key={`unassigned:${date}`} role="group" aria-label={`${dateInfo(date).monthDay}の非稼働`} data-memo-grid="true" data-shift-export-selected={selected ? "true" : undefined}
                className="relative flex min-h-28 flex-col items-start gap-1.5 bg-slate-50 p-1.5 pt-3"
                style={{backgroundColor:memoBackgroundColor(backgroundColors,date), ...memoGridStyle(selected,{left:true,right:true,bottom:true})}}>
                {people.map(token => <PersonSlip key={token.personKey} token={token} dayOff={!!token.driverId && dayOffByDate.get(date)?.has(token.driverId)} selected={selectedToken?.personKey === token.personKey && !selectedToken.sourceKey} onSelect={() => {selectColumn(date);selectToken(token);}} />)}
                {people.length === 0 && <span className="text-xs text-slate-300">—</span>}
              </div>;
            })}

            {exportMode && (
              <div
                ref={exportOverlayRef}
                data-html2canvas-ignore="true"
                className="absolute bottom-0 right-0 top-16 z-[60] touch-none cursor-crosshair select-none"
                style={{ left: laneWidth }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  const cell = cellAtExportPoint(event.clientX, event.clientY);
                  if (!cell) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  exportSelectionStartRef.current = cell;
                  exportPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
                  setExportSelection(selectionFromCells(cell, cell));
                  setExportPreviewUrl(null);
                  exportArtifactsRef.current = null;
                  setExportError("");
                  startExportAutoScroll();
                }}
                onPointerMove={(event) => {
                  if (!exportSelectionStartRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  exportPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
                  updateExportSelectionAt(event.clientX, event.clientY);
                  scrollExportAtPointer();
                }}
                onPointerUp={(event) => {
                  if (!exportSelectionStartRef.current) return;
                  exportPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
                  const cell = cellAtExportPoint(event.clientX, event.clientY);
                  const selection = cell ? selectionFromCells(exportSelectionStartRef.current, cell) : null;
                  exportSelectionStartRef.current = null;
                  stopExportAutoScroll();
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  if (!selection) {
                    setExportSelection(null);
                    setExportError("セルを選択できませんでした");
                    return;
                  }
                  setExportSelection(selection);
                  void refreshExportPreview(selection);
                }}
                onPointerCancel={(event) => {
                  exportSelectionStartRef.current = null;
                  stopExportAutoScroll();
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
              >
                {exportSelection ? (() => {
                  const top = exportSelection.y - 64;
                  const left = exportSelection.x - laneWidth;
                  return (
                    <>
                      <div className="pointer-events-none absolute left-0 right-0 top-0 bg-slate-950/30" style={{ height: top }} />
                      <div className="pointer-events-none absolute left-0 bg-slate-950/30" style={{ top, width: left, height: exportSelection.height }} />
                      <div className="pointer-events-none absolute right-0 bg-slate-950/30" style={{ top, left: left + exportSelection.width, height: exportSelection.height }} />
                      <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-slate-950/30" style={{ top: top + exportSelection.height }} />
                      <div
                        className="pointer-events-none absolute border-y-2 border-l-2 border-amber-500 bg-amber-50/15"
                        style={{ left: -laneWidth, top, width: laneWidth, height: exportSelection.height }}
                      />
                      <div
                        className="pointer-events-none absolute border-x-2 border-t-2 border-amber-500 bg-amber-50/20"
                        style={{ left, top: -64, width: exportSelection.width, height: 64 }}
                      />
                      <div
                        className="pointer-events-none absolute border-2 border-amber-500 bg-amber-50/5 shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_8px_30px_rgba(15,23,42,0.2)]"
                        style={{ left, top, width: exportSelection.width, height: exportSelection.height }}
                      >
                        <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-sm border-2 border-white bg-amber-500 shadow" />
                      </div>
                    </>
                  );
                })() : (
                  <div className="pointer-events-none absolute inset-0 bg-slate-950/10" />
                )}
              </div>
            )}
          </div>
        </section>

        <button type="button" onPointerDown={(event) => startResize(event, detailWidth, setDetailWidth, 280, 520, -1)} className="group relative hidden cursor-col-resize bg-slate-100 hover:bg-indigo-200 lg:block" aria-label={`右パネルの幅を変更（現在${detailWidth}px）`}><span className="absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-300" /></button>

        {exportMode ? (
          <aside className="min-h-0 border-t border-slate-200 bg-slate-50/70 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-900">エクスポート</h2>
                </div>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <FontAwesomeIcon icon={faCropSimple} className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
            <div className="space-y-4 p-3.5">
              {!exportSelection ? (
                <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4 text-center">
                  <h3 className="mb-3 text-xs font-bold text-slate-800">範囲を選択</h3>
                  <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm ring-1 ring-amber-200">
                    <FontAwesomeIcon icon={faCropSimple} className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-xs font-bold text-slate-800">必要なセルをドラッグしてください</p>
                  <button type="button" onClick={selectWholeBoard} className="mt-3 h-8 rounded-lg border border-amber-300 bg-white px-3 text-[10px] font-bold text-amber-800 hover:border-amber-500">
                    表全体を選択
                  </button>
                </section>
              ) : (
                <>
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                      <div>
                        <div className="text-[9px] font-medium text-slate-400">書き出しプレビュー</div>
                        <div className="mt-0.5 text-[10px] font-bold text-slate-700">
                          {(() => {
                            const range = exportDateRange(exportSelection, laneWidth, dayWidth, dates);
                            return exportDateLabel(range.start, range.end);
                          })()}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setExportSelection(null);
                          setExportPreviewUrl(null);
                          exportArtifactsRef.current = null;
                          setExportError("");
                        }}
                        className="h-7 rounded-md px-2 text-[9px] font-bold text-slate-500 hover:bg-slate-100"
                      >
                        選び直す
                      </button>
                    </div>
                    <div className="flex min-h-48 items-center justify-center bg-slate-200/60 p-3">
                      {exportBusy ? (
                        <div className="flex flex-col items-center gap-2 text-slate-500">
                          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                          <span className="text-[10px] font-medium">プレビュー作成中</span>
                        </div>
                      ) : exportPreviewUrl ? (
                        <img src={exportPreviewUrl} alt="選択したシフトメモの書き出しプレビュー" className="max-h-[52vh] max-w-full rounded-sm bg-white shadow-lg" />
                      ) : (
                        <button type="button" onClick={() => void refreshExportPreview(exportSelection)} className="h-9 rounded-lg bg-slate-900 px-4 text-[10px] font-bold text-white hover:bg-slate-700">
                          プレビューを作成
                        </button>
                      )}
                    </div>
                  </section>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={exportBusy || !exportPreviewUrl}
                      onClick={() => downloadExport("png")}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-[11px] font-bold text-slate-700 shadow-sm hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <FontAwesomeIcon icon={faImage} className="h-3.5 w-3.5 text-sky-600" />PNG画像
                    </button>
                    <button
                      type="button"
                      disabled={exportBusy || !exportPreviewUrl}
                      onClick={() => downloadExport("pdf")}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 text-[11px] font-bold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <FontAwesomeIcon icon={faFilePdf} className="h-3.5 w-3.5 text-rose-300" />PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadMemoData("csv")}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-[11px] font-bold text-slate-700 shadow-sm hover:border-slate-500"
                    >
                      <FontAwesomeIcon icon={faFileCsv} className="h-3.5 w-3.5 text-emerald-600" />CSV（全体）
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadMemoData("json")}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-[11px] font-bold text-slate-700 shadow-sm hover:border-slate-500"
                    >
                      <FontAwesomeIcon icon={faFileCode} className="h-3.5 w-3.5 text-violet-600" />JSON（全体）
                    </button>
                  </div>
                </>
              )}

              {exportError && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-medium text-rose-700">{exportError}</p>
              )}
            </div>
          </aside>
        ) : (
        <aside className="min-h-0 border-t border-slate-200 bg-slate-50/70 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <h2 className="text-lg font-black text-slate-900">{selection?.kind === "row" || selection?.kind === "course" ? "行の操作" : selectedDate ? `${dateInfo(selectedDate).monthDay}（${dateInfo(selectedDate).weekday}）` : "範囲を選ぶ"}</h2>
          </div>
          <div className="space-y-4 p-3.5">
            {selectedDate && selectedShortages.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold text-amber-900">不足している担当枠</h3><span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-bold text-amber-800">あと{selectedShortages.reduce((sum, entry) => sum + entry.shortage, 0)}人</span></div><div className="mt-2 flex flex-wrap gap-1.5">{selectedShortages.map(({ lane, shortage }) => <span key={lane.id} className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700">{lane.name} <span className="text-amber-700">あと{shortage}</span></span>)}</div></section>
            )}

            <section aria-label="候補の名前札" onDragOver={(event) => event.preventDefault()} onDrop={returnPersonToRack} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <h3 className="mb-2 text-xs font-bold text-slate-700">名前札 <span className="font-normal text-slate-400">{candidates.length - hiddenCandidates.length}人</span></h3>
              <div className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5"><FontAwesomeIcon icon={faMagnifyingGlass} className="h-3 w-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名前・コードで検索" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>
              <div className="flex min-h-11 max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-1.5">
                {filteredDrivers.map((driver) => {
                  const token: PersonToken = { personKey: `driver:${driver.id}`, driverId: driver.id, name: getDisplayName(driver) };
                  return <PersonSlip key={driver.id} token={token} workDays={workDays.get(token.personKey)?.days ?? 0} code={driver.driver_code} dayOff={dayOffOn(selectedDate)?.has(driver.id)} selected={selectedToken?.personKey === token.personKey && !selectedToken.sourceKey} onSelect={() => selectToken(token)} />;
                })}
                {visibleCustomPeople.map((name) => {
                  const token: PersonToken = { personKey: `custom:${name}`, name };
                  return (
                    <span key={token.personKey} className="inline-flex items-center">
                      <PersonSlip token={token} workDays={workDays.get(token.personKey)?.days ?? 0} selected={selectedToken?.personKey === token.personKey && !selectedToken.sourceKey} onSelect={() => selectToken(token)} />
                      <button type="button" onClick={() => removeCustomPerson(name)} aria-label={`${name}の札を消す`} title={`${name}の札を消す`} className="-ml-px inline-flex h-7 w-5 items-center justify-center rounded-r-md border border-l-0 border-slate-200 bg-white text-slate-400 hover:bg-rose-50 hover:text-rose-600"><FontAwesomeIcon icon={faXmark} className="h-2.5 w-2.5" /></button>
                    </span>
                  );
                })}
              </div>
              {filteredDrivers.length + visibleCustomPeople.length === 0 && <p className="mt-2 text-[11px] text-slate-500">{search.trim() ? "一致する名前札がありません" : "表示中の名前札はありません"}</p>}
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2" onDragOver={event => { if (editable) event.preventDefault(); }} onDrop={dropHiddenCandidate}>
                <button id="shift-memo-hidden-people-toggle" type="button" data-shared-refresh style={{ pointerEvents: "auto" }} aria-expanded={hiddenPeopleOpen} aria-controls="shift-memo-hidden-people" onClick={() => setHiddenPeopleOpen(open => !open)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                  <span className="inline-flex items-center gap-2"><FontAwesomeIcon icon={faEyeSlash} className="h-3 w-3" />非表示の札（{hiddenCandidates.length}人）</span>
                  <FontAwesomeIcon icon={faChevronDown} className={cn("h-2.5 w-2.5 transition-transform", hiddenPeopleOpen && "rotate-180")} />
                </button>
                {editable && <button type="button" aria-label={selectedCandidate ? `${selectedCandidate.name}を非表示にする` : "名前札を非表示にする"} disabled={!selectedCandidate || !!hiddenPeople[selectedCandidate.personKey]} onClick={() => { if (selectedCandidate) hideCandidate(selectedCandidate.personKey); }} className="mt-2 min-h-11 w-full break-words rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40">非表示</button>}
                <SmoothCollapse open={hiddenPeopleOpen} id="shift-memo-hidden-people" labelledBy="shift-memo-hidden-people-toggle">
                  <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                    {hiddenCandidates.length ? hiddenCandidates.map(token => <button key={token.personKey} type="button" disabled={!editable} onClick={() => restoreCandidate(token)} aria-label={`${token.name}を名前札に戻す`} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-indigo-50 disabled:opacity-60"><span className="truncate">{token.name}</span><span className="shrink-0 text-[10px] text-indigo-600">戻す</span></button>) : <p className="px-2 py-2 text-[11px] text-slate-500">非表示の名前札はありません</p>}
                    {!editable && hiddenCandidates.length > 0 && <p className="px-2 text-[10px] text-slate-500">名前札の復元にはシフト編集権限が必要です</p>}
                  </div>
                </SmoothCollapse>
              </div>
              <div className="mt-2 flex h-8 items-center rounded-lg border border-dashed border-slate-300 pl-2.5"><input value={customName} onChange={(event) => setCustomName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) addCustomPerson(); }} placeholder="応援1名・未定など" className="min-w-0 flex-1 text-xs outline-none" /><button type="button" onClick={addCustomPerson} className="inline-flex h-full items-center gap-1 px-2 text-[10px] font-medium text-slate-600 hover:bg-slate-50"><FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" />文字札</button></div>
            </section>

            {selectedDate && (
            <>
            {(dayOffOn(selectedDate)?.size ?? 0) > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-xs font-bold text-slate-700">この日の希望休</h3>
                <div className="flex flex-wrap gap-1.5">
                  {drivers.filter((driver) => dayOffOn(selectedDate)?.has(driver.id)).map((driver) => (
                    <span key={driver.id} className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700">{getDisplayName(driver)}</span>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-3"><label htmlFor="shift-memo-notes" className="mb-1.5 block text-xs font-bold text-slate-700">この日のメモ</label>{mode === "shared" && cursors.cellPeers[`notes:${selectedDate}`]?.map(peer => <span key={peer.id} data-html2canvas-ignore="true" className="mb-1 mr-1 inline-block rounded px-1.5 py-1 text-[10px] font-bold text-white" style={{ backgroundColor: peer.color }}>{peer.name}が編集中</span>)}<textarea id="shift-memo-notes" value={notes[selectedDate] ?? ""} maxLength={2000} onFocus={() => { if (mode === "shared") cursors.reportCell(`notes:${selectedDate}`); }} onBlur={() => { if (mode === "shared") cursors.reportCell(null); }} onChange={(event) => { const date = selectedDate; setNotes((current) => ({ ...current, [date]: event.target.value })); }} rows={4} className="w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-slate-400" /></section>
            </>
            )}
          </div>
        </aside>
        )}
      </div>

      {activePanel?.kind === "add" && activeRoute && createPortal(
        <><div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={() => closeActivePanel(true)} /><section role="dialog" aria-modal="true" aria-label={`${activeRoute.name}に担当枠を追加`} onKeyDown={(event) => trapDialogFocus(event, () => closeActivePanel(true))} className="fixed z-[100] rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xl" style={floatingPanelPosition(activePanel.anchor, 256, 92)}><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor="personal-memo-new-lane" className="text-[10px] font-bold text-slate-600">{activeRoute.name}に担当枠を追加</label><button type="button" onClick={() => closeActivePanel(true)} className="text-[10px] text-slate-400 hover:text-slate-700">閉じる</button></div><div className="flex h-8 overflow-hidden rounded-lg border border-slate-200"><input id="personal-memo-new-lane" autoFocus value={newLaneName} onChange={(event) => setNewLaneName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addLane(activeRoute); }} placeholder="町名・エリア名・作業名" className="min-w-0 flex-1 px-2 text-[11px] outline-none" /><button type="button" onClick={() => addLane(activeRoute)} className="border-l border-slate-200 bg-slate-800 px-3 text-[10px] font-semibold text-white">追加</button></div></section></>,
        document.body,
      )}

      {activePanel?.kind === "edit" && activeLane && createPortal(
        <><div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={() => closeActivePanel(true)} /><section role="dialog" aria-modal="true" aria-labelledby="personal-memo-lane-editor" onKeyDown={(event) => trapDialogFocus(event, () => closeActivePanel(true))} className="fixed z-[100] rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xl" style={floatingPanelPosition(activePanel.anchor, 320, 218)}><div className="mb-2 flex items-center justify-between gap-3"><div id="personal-memo-lane-editor" className="text-[10px] font-bold text-slate-700">担当枠を編集</div><button type="button" onClick={() => closeActivePanel(true)} className="text-[10px] text-slate-400">閉じる</button></div><input autoFocus value={settingsName} onChange={(event) => setSettingsName(event.target.value)} className="mb-2 h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold outline-none" aria-label="担当枠名" /><div className="mb-2 grid grid-cols-[1fr_auto] items-end gap-2"><div><div className="mb-1 text-[9px] text-slate-500">稼働曜日</div><div className="grid grid-cols-7 gap-1">{WEEKDAY_OPTIONS.map((weekday) => { const active = settingsWeekdays.includes(weekday.value); return <button key={weekday.value} type="button" aria-pressed={active} onClick={() => setSettingsWeekdays((current) => active ? current.filter((value) => value !== weekday.value) : [...current, weekday.value])} className={cn("h-7 rounded-md border text-[10px] font-bold", active ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-400")}>{weekday.label}</button>; })}</div></div><div><div className="mb-1 text-center text-[9px] text-slate-500">必要人数</div><div className="flex h-7 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50"><button type="button" onClick={() => setSettingsRequiredCount((count) => Math.max(0, count - 1))} className="flex h-full w-7 items-center justify-center text-slate-500" aria-label="必要人数を減らす"><FontAwesomeIcon icon={faMinus} className="h-2.5 w-2.5" /></button><span className="w-7 text-center text-xs font-bold leading-none tabular-nums">{settingsRequiredCount}</span><button type="button" onClick={() => setSettingsRequiredCount((count) => Math.min(10, count + 1))} className="flex h-full w-7 items-center justify-center text-slate-500" aria-label="必要人数を増やす"><FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" /></button></div></div></div><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => { setHiddenLaneIds((ids) => ids.includes(activeLane.id) ? ids : [...ids, activeLane.id]); setActivePanel(null); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[9px] text-slate-400 hover:bg-slate-100"><FontAwesomeIcon icon={faEyeSlash} className="h-2.5 w-2.5" />非表示</button><button type="button" disabled={!settingsName.trim() || settingsWeekdays.length === 0} onClick={() => saveLaneSettings(activeLane.id)} className="h-8 min-w-28 rounded-lg bg-slate-900 px-4 text-[10px] font-semibold text-white disabled:opacity-40">設定を反映</button></div></section></>,
        document.body,
      )}

      {activePanel?.kind === "required" && requiredLane && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={() => closeActivePanel(true)} />
          <section role="dialog" aria-modal="true" aria-labelledby="personal-memo-required-title personal-memo-required-course" onKeyDown={(event) => trapDialogFocus(event, () => closeActivePanel(true))} className="fixed z-[100] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl" style={floatingPanelPosition(activePanel.anchor, 320, 250)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><h2 id="personal-memo-required-title" className="text-lg font-bold text-slate-800">{dateInfo(activePanel.date).monthDay}（{dateInfo(activePanel.date).weekday}）</h2><p id="personal-memo-required-course" className="mt-1 break-words text-lg font-bold leading-snug text-slate-800">{requiredCourseName}</p>{requiredLane.name !== requiredCourseName && <p className="mt-1 break-words text-xs text-slate-500">{requiredLane.name}</p>}</div>
              <button autoFocus type="button" onClick={() => closeActivePanel(true)} aria-label="閉じる" className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50"><FontAwesomeIcon icon={faXmark} className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 flex items-center justify-center">
              <div className="flex w-full items-center justify-between overflow-hidden rounded-lg border border-slate-200">
                <button type="button" disabled={dailyRequiredCount === 0} onClick={() => changeDailyRequiredCount(-1)} aria-label="必要人数を減らす" className="inline-flex h-12 w-12 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30"><FontAwesomeIcon icon={faMinus} className="h-3 w-3" /></button>
                <output aria-live="polite" aria-label="この日の必要人数" className="text-center text-2xl font-bold tabular-nums text-slate-800">{dailyRequiredCount}<span className="ml-1 text-xs font-normal">人</span></output>
                <button type="button" disabled={dailyRequiredCount === MAX_REQUIRED_COUNT} onClick={() => changeDailyRequiredCount(1)} aria-label="必要人数を増やす" className="inline-flex h-12 w-12 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30"><FontAwesomeIcon icon={faPlus} className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-500">通常:{requiredLane.requiredCount}人</span><button type="button" disabled={requiredCountOverrides[cellKey(requiredLane.id, activePanel.date)] === undefined} onClick={() => changeDailyRequiredCount(null)} aria-label="必要人数をリセット" title="リセット" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-30"><FontAwesomeIcon icon={faRotateLeft} className="h-3.5 w-3.5" /></button></div>
          </section>
        </>, document.body,
      )}

      {pendingDuplicate && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={() => setPendingDuplicate(null)}><section role="alertdialog" aria-modal="true" aria-labelledby="personal-memo-duplicate" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => trapDialogFocus(event, () => setPendingDuplicate(null))}><div className="flex items-start gap-3"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><FontAwesomeIcon icon={faTriangleExclamation} className="h-4 w-4" /></span><div><h2 id="personal-memo-duplicate" className="text-sm font-black text-slate-900">同じ日に配置済みです</h2><p className="mt-2 text-xs leading-relaxed text-slate-600">{pendingDuplicate.token.name}さんは「{pendingDuplicate.existingNames.join("」「")}」へ置かれています。この担当枠にも置きますか？</p></div></div><div className="mt-5 flex justify-end gap-2"><button autoFocus type="button" onClick={() => setPendingDuplicate(null)} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600">キャンセル</button><button type="button" onClick={() => { applyPersonDrop(pendingDuplicate.token, pendingDuplicate.targetKey); setPendingDuplicate(null); }} className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white">それでも配置</button></div></section></div>,
        document.body,
      )}
    </div>
  );
}
