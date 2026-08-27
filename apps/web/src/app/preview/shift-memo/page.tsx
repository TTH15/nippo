"use client";

import Link from "next/link";
import {
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
  faArrowLeft,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCropSimple,
  faDownload,
  faEllipsis,
  faEye,
  faEyeSlash,
  faFilePdf,
  faGripLines,
  faImage,
  faLock,
  faMagnifyingGlass,
  faPlus,
  faRotateLeft,
  faTriangleExclamation,
  faTruck,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { exportBodySlices, exportEdgeVelocity, selectedShortageCount } from "@/lib/shiftMemoExport";
import { cn } from "@/lib/ui/utils";
import { assignedPersonCount, findDuplicateCourseIds, shortageCount } from "./previewLogic";

type Course = {
  id: string;
  name: string;
  carrier: string;
  routeId: string;
  color: string;
  activeWeekdays: number[];
  requiredCount: number;
};
type RouteGroup = {
  id: string;
  name: string;
  carrier: string;
  color: string;
  defaultWeekdays: number[];
  defaultRequiredCount: number;
};
type PersonToken = { name: string; sourceKey?: string };
type PanelAnchor = { left: number; top: number; right: number; bottom: number };
type ExportSelection = { x: number; y: number; width: number; height: number; routeIds: string[]; courseIds: string[] };
type ExportArtifacts = { png: Blob; pdf: Blob; filename: string };
type ExportCellAnchor = { dayIndex: number; rowIndex: number };
type ActivePanel =
  | { kind: "add"; routeId: string; anchor: PanelAnchor }
  | { kind: "edit"; courseId: string; anchor: PanelAnchor }
  | null;

const DAYS = Array.from({ length: 15 }, (_, index) => index + 1);
const WEEKDAYS = ["土", "日", "月", "火", "水", "木", "金", "土", "日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_NUMBERS = [6, 0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6];
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
const TUE_TO_SAT = [2, 3, 4, 5, 6];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const PEOPLE = ["日笠", "坂田", "廣瀬", "猪上", "木下", "梶原", "勝政", "平石", "島本", "杉本", "池畑", "木村", "吉田", "磯江", "辻村", "桑野", "川人", "山本", "西脇", "平中"];
const ROUTE_GROUPS: RouteGroup[] = [
  { id: "yamato-yokooji", name: "横大路", carrier: "ヤマト運輸", color: "#3b82f6", defaultWeekdays: MON_TO_SAT, defaultRequiredCount: 2 },
  { id: "yamato-mibu", name: "壬生", carrier: "ヤマト運輸", color: "#ef4444", defaultWeekdays: MON_TO_SAT, defaultRequiredCount: 1 },
  { id: "yamato-ujitawara", name: "宇治田原", carrier: "ヤマト運輸", color: "#22c55e", defaultWeekdays: TUE_TO_SAT, defaultRequiredCount: 1 },
  { id: "yamato-mid", name: "ミッド", carrier: "ヤマト運輸", color: "#8b5cf6", defaultWeekdays: MON_TO_SAT, defaultRequiredCount: 1 },
  { id: "amazon-kamitoba", name: "上鳥羽吉祥院", carrier: "Amazon", color: "#f59e0b", defaultWeekdays: EVERY_DAY, defaultRequiredCount: 1 },
  { id: "other-spot", name: "スポット便", carrier: "その他", color: "#f97316", defaultWeekdays: MON_TO_SAT, defaultRequiredCount: 1 },
];
const INITIAL_COURSES: Course[] = [
  { id: "yokooji-mozume", name: "物集女", carrier: "ヤマト運輸", routeId: "yamato-yokooji", color: "#3b82f6", activeWeekdays: TUE_TO_SAT, requiredCount: 2 },
  { id: "yokooji-kuze", name: "久世", carrier: "ヤマト運輸", routeId: "yamato-yokooji", color: "#06b6d4", activeWeekdays: MON_TO_SAT, requiredCount: 2 },
  { id: "yokooji-shimosu", name: "横大路下三栖", carrier: "ヤマト運輸", routeId: "yamato-yokooji", color: "#6366f1", activeWeekdays: MON_TO_SAT, requiredCount: 1 },
  { id: "mibu-matsubara", name: "壬生松原町", carrier: "ヤマト運輸", routeId: "yamato-mibu", color: "#ef4444", activeWeekdays: MON_TO_SAT, requiredCount: 1 },
  { id: "mibu-bojo", name: "壬生坊城町", carrier: "ヤマト運輸", routeId: "yamato-mibu", color: "#f97316", activeWeekdays: MON_TO_SAT, requiredCount: 1 },
  { id: "ujitawara-gonokuchi", name: "郷之口", carrier: "ヤマト運輸", routeId: "yamato-ujitawara", color: "#22c55e", activeWeekdays: TUE_TO_SAT, requiredCount: 1 },
  { id: "ujitawara-tachikawa", name: "立川", carrier: "ヤマト運輸", routeId: "yamato-ujitawara", color: "#84cc16", activeWeekdays: TUE_TO_SAT, requiredCount: 1 },
  { id: "mid-area-a", name: "ミッド Aエリア", carrier: "ヤマト運輸", routeId: "yamato-mid", color: "#8b5cf6", activeWeekdays: MON_TO_SAT, requiredCount: 1 },
  { id: "mid-area-b", name: "ミッド Bエリア", carrier: "ヤマト運輸", routeId: "yamato-mid", color: "#a855f7", activeWeekdays: MON_TO_SAT, requiredCount: 1 },
  { id: "amazon-nishikujo", name: "西九条エリア", carrier: "Amazon", routeId: "amazon-kamitoba", color: "#f59e0b", activeWeekdays: EVERY_DAY, requiredCount: 2 },
  { id: "amazon-kisshoin", name: "吉祥院エリア", carrier: "Amazon", routeId: "amazon-kamitoba", color: "#ec4899", activeWeekdays: EVERY_DAY, requiredCount: 2 },
  { id: "spot-free", name: "フリー枠", carrier: "その他", routeId: "other-spot", color: "#f97316", activeWeekdays: MON_TO_SAT, requiredCount: 1 },
];

const PERSON_COLORS = ["#06b6d4", "#8b5cf6", "#f97316", "#22c55e", "#3b82f6", "#ec4899"];
const PERSON_DRAG_TYPE = "application/x-hakotora-preview-person";
const COURSE_DRAG_TYPE = "application/x-hakotora-preview-course";

function cellKey(courseId: string, day: number): string {
  return `${courseId}:${day}`;
}

function isCourseActive(course: Course, day: number): boolean {
  return course.activeWeekdays.includes(WEEKDAY_NUMBERS[day - 1]);
}

function weekdaySummary(activeWeekdays: number[]): string {
  return WEEKDAY_OPTIONS.filter((weekday) => activeWeekdays.includes(weekday.value))
    .map((weekday) => weekday.label)
    .join("・");
}

function colorForPerson(name: string): string {
  let sum = 0;
  for (const char of name) sum += char.charCodeAt(0);
  return PERSON_COLORS[sum % PERSON_COLORS.length];
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

function exportDayRange(selection: ExportSelection, courseWidth: number, dayWidth: number) {
  const selectionStart = selection.x;
  const selectionEnd = selection.x + selection.width;
  if (selectionEnd <= courseWidth) return { start: 1, end: 1 };
  const start = Math.max(1, Math.min(DAYS.length, Math.floor((Math.max(selectionStart, courseWidth) - courseWidth) / dayWidth) + 1));
  const end = Math.max(start, Math.min(DAYS.length, Math.ceil((selectionEnd - courseWidth) / dayWidth)));
  return { start, end };
}

function exportDateLabel(start: number, end: number) {
  const first = `2026年8月${start}日（${WEEKDAYS[start - 1]}）`;
  return start === end ? first : `${first}〜${end}日（${WEEKDAYS[end - 1]}）`;
}

function createMockAssignments(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  INITIAL_COURSES.forEach((course, courseIndex) => {
    DAYS.forEach((day) => {
      if (!isCourseActive(course, day)) return;
      if ((day + courseIndex * 2) % 4 === 0) return;
      result[cellKey(course.id, day)] = [PEOPLE[(day * 3 + courseIndex * 2) % PEOPLE.length]];
      if ((day + courseIndex) % 5 === 0) {
        result[cellKey(course.id, day)].push(PEOPLE[(day + courseIndex * 5 + 7) % PEOPLE.length]);
      }
    });
  });
  return result;
}

function PersonSlip({
  name,
  sourceKey,
  selected = false,
  onSelect,
  onRemove,
}: {
  name: string;
  sourceKey?: string;
  selected?: boolean;
  onSelect?: (token: PersonToken) => void;
  onRemove?: () => void;
}) {
  const token = { name, sourceKey };
  return (
    <div
      data-shift-export-slip="true"
      draggable
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${name}の名前札${sourceKey ? "。Deleteキーで配置解除" : ""}`}
      onClick={() => onSelect?.(token)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(token);
        } else if (sourceKey && onRemove && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          onRemove();
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = sourceKey ? "move" : "copy";
        event.dataTransfer.setData(PERSON_DRAG_TYPE, JSON.stringify(token));
      }}
      className={cn("inline-flex h-7 max-w-full cursor-grab items-center overflow-hidden rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)] outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-indigo-500", selected && "ring-2 ring-indigo-500")}
      style={{ borderLeftColor: colorForPerson(name), borderLeftWidth: 3 }}
    >
      <span data-shift-export-slip-text="true" className="min-w-0 truncate px-2">{name}</span>
    </div>
  );
}

export default function ShiftMemoPreviewPage() {
  const [selectedDay, setSelectedDay] = useState(4);
  const [dayWidth, setDayWidth] = useState(76);
  const [courseWidth, setCourseWidth] = useState(190);
  const [detailWidth, setDetailWidth] = useState(330);
  const [courses, setCourses] = useState<Course[]>(INITIAL_COURSES);
  const [assignments, setAssignments] = useState<Record<string, string[]>>(createMockAssignments);
  const [courseOrder, setCourseOrder] = useState(INITIAL_COURSES.map((course) => course.id));
  const [hiddenCourseIds, setHiddenCourseIds] = useState<string[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const activePanelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [newCourseName, setNewCourseName] = useState("");
  const [settingsCourseName, setSettingsCourseName] = useState("");
  const [settingsWeekdays, setSettingsWeekdays] = useState<number[]>([]);
  const [settingsRequiredCount, setSettingsRequiredCount] = useState(1);
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    token: PersonToken;
    targetKey: string;
    existingCourseNames: string[];
  } | null>(null);
  const [search, setSearch] = useState("");
  const [customName, setCustomName] = useState("");
  const [extraPeople, setExtraPeople] = useState<string[]>([]);
  const [selectedToken, setSelectedToken] = useState<PersonToken | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [note, setNote] = useState("鈴木さんは午前だけ。応援1名は昼までに確定予定。\nミッド社員の配置は前日に再確認する。");
  const boardScrollerRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const exportOverlayRef = useRef<HTMLDivElement | null>(null);
  const exportSelectionStartRef = useRef<ExportCellAnchor | null>(null);
  const exportPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const exportAutoScrollFrameRef = useRef<number | null>(null);
  const exportArtifactsRef = useRef<ExportArtifacts | null>(null);
  const [exportMode, setExportMode] = useState(false);
  const [exportSelection, setExportSelection] = useState<ExportSelection | null>(null);
  const [exportPreviewUrl, setExportPreviewUrl] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const addingRouteId = activePanel?.kind === "add" ? activePanel.routeId : null;
  const settingsCourseId = activePanel?.kind === "edit" ? activePanel.courseId : null;

  const closeActivePanel = (restoreFocus = false) => {
    setActivePanel(null);
    if (restoreFocus) requestAnimationFrame(() => activePanelTriggerRef.current?.focus());
  };

  useEffect(() => {
    if (!activePanel) return;
    const closeOnScroll = () => {
      setActivePanel(null);
      requestAnimationFrame(() => activePanelTriggerRef.current?.focus({ preventScroll: true }));
    };
    const repositionOnResize = () => {
      const rect = activePanelTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { left, top, right, bottom } = rect;
      setActivePanel((current) => current ? { ...current, anchor: { left, top, right, bottom } } : null);
    };
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", repositionOnResize);
    window.visualViewport?.addEventListener("resize", repositionOnResize);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", repositionOnResize);
      window.visualViewport?.removeEventListener("resize", repositionOnResize);
    };
  }, [activePanel]);

  const orderedCourses = useMemo(() => {
    const byId = new Map(courses.map((course) => [course.id, course]));
    return courseOrder.map((id) => byId.get(id)).filter((course): course is Course => !!course);
  }, [courseOrder, courses]);
  const visibleCourses = orderedCourses.filter((course) => !hiddenCourseIds.includes(course.id));
  const hiddenCourses = orderedCourses.filter((course) => hiddenCourseIds.includes(course.id));
  const filteredPeople = [...PEOPLE, ...extraPeople].filter((name) => name.includes(search.trim()));
  const boardWidth = courseWidth + dayWidth * DAYS.length;
  const shortageFor = (course: Course, day: number) => shortageCount(
    isCourseActive(course, day),
    course.requiredCount,
    assignments[cellKey(course.id, day)] ?? [],
  );
  const dayShortage = (day: number) => visibleCourses.reduce((total, course) => total + shortageFor(course, day), 0);

  const applyPersonDrop = (token: PersonToken, targetKey: string) => {
    if (token.sourceKey === targetKey) return;
    setAssignments((current) => {
      const next = { ...current };
      if (token.sourceKey) {
        const source = [...(next[token.sourceKey] ?? [])];
        const sourceIndex = source.indexOf(token.name);
        if (sourceIndex >= 0) source.splice(sourceIndex, 1);
        next[token.sourceKey] = source;
      }
      next[targetKey] = [...(next[targetKey] ?? []), token.name];
      return next;
    });
    const targetName = courses.find((course) => course.id === targetKey.split(":")[0])?.name ?? "担当枠";
    setLiveMessage(`${token.name}を${targetName}へ配置しました`);
  };

  const requestPersonPlacement = (token: PersonToken, targetKey: string) => {
    if (token.sourceKey === targetKey) return;

    const targetDay = Number(targetKey.split(":").at(-1));
    const duplicateIds = findDuplicateCourseIds(
      assignments,
      courses.map((course) => course.id),
      targetDay,
      token.name,
      token.sourceKey,
    );
    const existingCourseNames = duplicateIds
      .map((id) => courses.find((course) => course.id === id)?.name)
      .filter((name): name is string => !!name);

    if (existingCourseNames.length > 0) {
      setPendingDuplicate({ token, targetKey, existingCourseNames });
      setSelectedToken(null);
      return;
    }

    applyPersonDrop(token, targetKey);
    setSelectedToken(null);
  };

  const dropPerson = (event: DragEvent, targetKey: string) => {
    const raw = event.dataTransfer.getData(PERSON_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    requestPersonPlacement(JSON.parse(raw) as PersonToken, targetKey);
  };

  const selectPersonToken = (token: PersonToken) => {
    const sameToken = selectedToken?.name === token.name && selectedToken.sourceKey === token.sourceKey;
    setSelectedToken(sameToken ? null : token);
    setLiveMessage(sameToken ? `${token.name}の選択を解除しました` : `${token.name}を選択しました。配置先でEnterキーを押してください`);
  };

  const removePerson = (sourceKey: string, name: string) => {
    setAssignments((current) => {
      const source = [...(current[sourceKey] ?? [])];
      const sourceIndex = source.indexOf(name);
      if (sourceIndex >= 0) source.splice(sourceIndex, 1);
      return { ...current, [sourceKey]: source };
    });
    setSelectedToken(null);
    setLiveMessage(`${name}の配置を解除しました`);
  };

  const returnPersonToRack = (event: DragEvent) => {
    const raw = event.dataTransfer.getData(PERSON_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    const token = JSON.parse(raw) as PersonToken;
    if (!token.sourceKey) return;
    removePerson(token.sourceKey, token.name);
  };

  const addCustomName = () => {
    const name = customName.trim().slice(0, 20);
    if (!name) return;
    setExtraPeople((current) => current.includes(name) || PEOPLE.includes(name) ? current : [...current, name]);
    setCustomName("");
  };

  const reorderCourse = (sourceId: string, targetId: string) => {
    const source = courses.find((course) => course.id === sourceId);
    const target = courses.find((course) => course.id === targetId);
    if (!source || !target || source.routeId !== target.routeId || sourceId === targetId) return;
    setCourseOrder((current) => {
      const next = current.filter((id) => id !== sourceId);
      next.splice(next.indexOf(targetId), 0, sourceId);
      return next;
    });
  };

  const addCourse = (route: RouteGroup) => {
    const name = newCourseName.trim().slice(0, 30);
    if (!name) return;
    const id = `custom-${route.id}-${Date.now()}`;
    setCourses((current) => [...current, {
      id,
      name,
      carrier: route.carrier,
      routeId: route.id,
      color: route.color,
      activeWeekdays: [...route.defaultWeekdays],
      requiredCount: route.defaultRequiredCount,
    }]);
    setCourseOrder((current) => [...current, id]);
    setNewCourseName("");
    closeActivePanel(true);
  };

  const openAddCourse = (route: RouteGroup, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (addingRouteId === route.id) {
      closeActivePanel(true);
      return;
    }
    activePanelTriggerRef.current = event.currentTarget;
    const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
    setNewCourseName("");
    setActivePanel({ kind: "add", routeId: route.id, anchor: { left, top, right, bottom } });
  };

  const openCourseSettings = (course: Course, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (settingsCourseId === course.id) {
      closeActivePanel(true);
      return;
    }
    activePanelTriggerRef.current = event.currentTarget;
    const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
    setActivePanel({ kind: "edit", courseId: course.id, anchor: { left, top, right, bottom } });
    setSettingsCourseName(course.name);
    setSettingsWeekdays([...course.activeWeekdays]);
    setSettingsRequiredCount(course.requiredCount);
  };

  const saveCourseSettings = (courseId: string) => {
    const name = settingsCourseName.trim().slice(0, 30);
    if (!name || settingsWeekdays.length === 0) return;
    setCourses((current) => current.map((course) => course.id === courseId
      ? {
          ...course,
          name,
          activeWeekdays: [...settingsWeekdays].sort((a, b) => a - b),
          requiredCount: Math.max(1, Math.min(10, settingsRequiredCount)),
        }
      : course));
    closeActivePanel(true);
  };

  const hideCourse = (course: Course) => {
    setHiddenCourseIds((ids) => ids.includes(course.id) ? ids : [...ids, course.id]);
    setActivePanel(null);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-route-add="${course.routeId}"]`)?.focus();
    });
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
    const onMove = (moveEvent: PointerEvent) => {
      const next = currentValue + (moveEvent.clientX - startX) * direction;
      onChange(Math.max(min, Math.min(max, Math.round(next))));
    };
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
      courseId: element.dataset.exportRow ?? "",
    }))
    .sort((a, b) => a.top - b.top);

  const cellAtExportPoint = (clientX: number, clientY: number): ExportCellAnchor | null => {
    const rows = exportRows();
    const overlay = exportOverlayRef.current;
    if (rows.length === 0 || !overlay) return null;
    const rect = overlay.getBoundingClientRect();
    const boardX = Math.max(courseWidth, Math.min(boardWidth - 1, clientX - rect.left + courseWidth));
    const boardY = Math.max(64, Math.min(overlay.offsetHeight + 63, clientY - rect.top + 64));
    const dayIndex = Math.max(0, Math.min(DAYS.length - 1, Math.floor((boardX - courseWidth) / dayWidth)));
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
      x: courseWidth + firstDay * dayWidth,
      y: rows[firstRow].top,
      width: (lastDay - firstDay + 1) * dayWidth,
      height: rows[lastRow].bottom - rows[firstRow].top,
      routeIds: Array.from(new Set(selectedRows.map((row) => row.routeId).filter(Boolean))),
      courseIds: selectedRows.map((row) => row.courseId),
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
    return exportBodySlices(exportRows(), headers, selection.y, selection.y + selection.height);
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
    const cellAreaLeft = Math.min(rect.right, rect.left + courseWidth);
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
    const selectedShortageByDay = new Map(DAYS.map((day) => [
      day,
      selectedShortageCount(selection.courseIds, (courseId) => {
        const course = courses.find((candidate) => candidate.id === courseId);
        return course ? shortageFor(course, day) : 0;
      }),
    ]));
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
          Object.assign(clonedScroller.style, { overflow: "visible" });
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
            left: "auto",
            right: "auto",
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
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-meta='true']").forEach((meta) => {
          Object.assign(meta.style, {
            lineHeight: "10px",
            paddingTop: "0",
          });
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
          const day = Number(badge.dataset.shiftExportDayShortage);
          const shortage = selectedShortageByDay.get(day) ?? 0;
          setExportPillLabel(badge, `不足${shortage}`);
          Object.assign(badge.style, {
            display: shortage > 0 ? "inline-block" : "none",
            marginTop: "3px",
          });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-export-route-header]").forEach((header) => {
          Object.assign(header.style, {
            boxSizing: "border-box",
            display: "block",
            height: "44px",
            padding: "6px 12px 5px",
            overflow: "hidden",
            backgroundColor: "#f1f5f9",
            borderLeftWidth: "0",
          });
          header.querySelectorAll<HTMLElement>("svg").forEach((icon) => {
            icon.style.display = "none";
          });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-route-copy='true']").forEach((copy) => {
          Object.assign(copy.style, {
            display: "block",
            height: "31px",
            lineHeight: "normal",
            overflow: "hidden",
            transform: "translateY(-1px)",
          });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-route-carrier='true']").forEach((carrier) => {
          Object.assign(carrier.style, { display: "block", height: "11px", lineHeight: "11px" });
        });
        clonedDocument.querySelectorAll<HTMLElement>("[data-shift-export-route-name='true']").forEach((name) => {
          Object.assign(name.style, { display: "block", height: "16px", lineHeight: "16px", marginTop: "1px" });
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
    const labelWidth = Math.round(courseWidth * sourceScaleX);
    const tableHeaderHeight = Math.round(64 * sourceScaleY);
    const tableWidth = labelWidth + dateCropWidth;
    const headerHeight = Math.round(74 * sourceScaleY);
    const output = document.createElement("canvas");
    output.width = Math.max(tableWidth, Math.round(300 * sourceScaleX));
    output.height = headerHeight + tableHeaderHeight + bodyHeight;
    const context = output.getContext("2d");
    if (!context) throw new Error("画像を作成できませんでした");

    const range = exportDayRange(selection, courseWidth, dayWidth);
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
      context.fillText("2026年8月 前半", output.width - Math.round(18 * sourceScaleX), Math.round(48 * sourceScaleY));
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
        const route = ROUTE_GROUPS.find((candidate) => candidate.id === slice.routeId);
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
    setExportBusy(true);
    setExportError("");
    exportArtifactsRef.current = null;
    try {
      const canvas = await buildExportCanvas(selection);
      const imageUrl = canvas.toDataURL("image/png");
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNGを作成できませんでした")), "image/png");
      });
      const range = exportDayRange(selection, courseWidth, dayWidth);
      const filename = `シフトメモ_2026-08-${String(range.start).padStart(2, "0")}${range.end === range.start ? "" : `_${String(range.end).padStart(2, "0")}`}`;
      const { jsPDF } = await import("jspdf");
      const pageWidth = 200;
      const pageHeight = pageWidth * (canvas.height / canvas.width);
      const pdfDocument = new jsPDF({
        orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
        unit: "mm",
        format: [pageWidth, pageHeight],
      });
      const pdfWidth = pdfDocument.internal.pageSize.getWidth();
      const pdfHeight = pdfDocument.internal.pageSize.getHeight();
      pdfDocument.addImage(imageUrl, "PNG", 0, 0, pdfWidth, pdfHeight);
      exportArtifactsRef.current = { png, pdf: pdfDocument.output("blob"), filename };
      setExportPreviewUrl(imageUrl);
    } catch (error) {
      console.error(error);
      exportArtifactsRef.current = null;
      setExportPreviewUrl(null);
      setExportError("プレビューを作成できませんでした");
    } finally {
      setExportBusy(false);
    }
  };

  const startExport = () => {
    stopExportAutoScroll();
    closeActivePanel(false);
    setExportMode(true);
    setExportSelection(null);
    setExportPreviewUrl(null);
    exportArtifactsRef.current = null;
    setExportError("");
  };

  const closeExport = () => {
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
      x: courseWidth,
      y: rows[0].top,
      width: dayWidth * DAYS.length,
      height: rows.at(-1)!.bottom - rows[0].top,
      routeIds: Array.from(new Set(rows.map((row) => row.routeId).filter(Boolean))),
      courseIds: rows.map((row) => row.courseId),
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

  const selectedAssignments = visibleCourses.map((course) => ({
    course,
    people: assignments[cellKey(course.id, selectedDay)] ?? [],
  }));
  const selectedShortages = selectedAssignments
    .map((entry) => ({ ...entry, shortage: shortageFor(entry.course, selectedDay) }))
    .filter((entry) => entry.shortage > 0);
  const activeRoute = activePanel?.kind === "add"
    ? ROUTE_GROUPS.find((route) => route.id === activePanel.routeId)
    : undefined;
  const activeCourse = activePanel?.kind === "edit"
    ? courses.find((course) => course.id === activePanel.courseId)
    : undefined;

  return (
    <main className="h-dvh overflow-hidden bg-slate-100 p-3 text-slate-900 md:p-5">
      <p className="sr-only" aria-live="polite">{liveMessage}</p>
      <div
        inert={activePanel !== null || pendingDuplicate !== null ? true : undefined}
        aria-hidden={activePanel !== null || pendingDuplicate !== null ? true : undefined}
        className="mx-auto flex h-[calc(100dvh-1.5rem)] min-h-0 max-w-[1900px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-300/30 md:h-[calc(100dvh-2.5rem)]"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 md:px-6">
          <Link href="/preview" aria-label="プレビュー一覧へ戻る" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <FontAwesomeIcon icon={faArrowLeft} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-slate-900">シフトメモ</h1>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                <FontAwesomeIcon icon={faLock} className="h-3 w-3" />個人メモ
              </span>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex h-9 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button type="button" className="h-full px-3 text-slate-500 hover:bg-slate-50" aria-label="前の半月"><FontAwesomeIcon icon={faChevronLeft} className="h-3 w-3" /></button>
              <span className="border-x border-slate-200 px-4 text-xs font-semibold">2026年8月 前半</span>
              <button type="button" className="h-full px-3 text-slate-500 hover:bg-slate-50" aria-label="次の半月"><FontAwesomeIcon icon={faChevronRight} className="h-3 w-3" /></button>
            </div>
            <div className="flex h-9 overflow-hidden rounded-lg border border-slate-200 bg-white text-xs font-semibold">
              <button type="button" className="bg-slate-800 px-4 text-white">前半</button>
              <button type="button" className="px-4 text-slate-500 hover:bg-slate-50">後半</button>
            </div>
            <button
              type="button"
              onClick={exportMode ? closeExport : startExport}
              aria-pressed={exportMode}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[11px] font-bold transition",
                exportMode
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
              )}
            >
              <FontAwesomeIcon icon={exportMode ? faXmark : faDownload} className="h-3 w-3" />
              {exportMode ? "選択を終了" : "エクスポート"}
            </button>
            {hiddenCourses.length > 0 && (
              <button type="button" onClick={() => setHiddenOpen((open) => !open)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600 hover:border-slate-400">
                <FontAwesomeIcon icon={faEye} className="h-3 w-3" />非表示 {hiddenCourses.length}件
                <FontAwesomeIcon icon={faChevronDown} className={cn("h-2.5 w-2.5 transition-transform", hiddenOpen && "rotate-180")} />
              </button>
            )}
          </div>
        </header>

        {hiddenOpen && hiddenCourses.length > 0 && (
          <section className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-amber-50 px-4 py-2.5 md:px-6">
            <span className="mr-1 text-[11px] font-bold text-amber-800">非表示の担当枠</span>
            {hiddenCourses.map((course) => (
              <button key={course.id} type="button" onClick={() => setHiddenCourseIds((ids) => ids.filter((id) => id !== course.id))} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2 text-[10px] font-medium text-slate-700 hover:border-amber-400">
                <span className="h-3 w-1 rounded-full" style={{ backgroundColor: course.color }} />{course.name}<FontAwesomeIcon icon={faRotateLeft} className="h-2.5 w-2.5 text-amber-600" />
              </button>
            ))}
            <button type="button" onClick={() => setHiddenCourseIds([])} className="ml-auto text-[10px] font-medium text-amber-700 hover:underline">すべて表示へ戻す</button>
          </section>
        )}

        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `minmax(0, 1fr) 7px ${detailWidth}px` }}>
          <section ref={boardScrollerRef} data-shift-export-scroller="true" className="min-h-0 min-w-0 overflow-auto bg-white">
            <div ref={boardRef} className="relative grid min-h-full content-start" style={{ gridTemplateColumns: `${courseWidth}px repeat(${DAYS.length}, ${dayWidth}px)`, width: boardWidth }}>
              <div data-shift-export-sticky="true" className="sticky left-0 top-0 z-50 flex h-16 items-center border-b border-r border-slate-200 bg-slate-50 px-3">
                <span className="text-xs font-bold text-slate-600">町名・担当枠</span>
                <button
                  data-html2canvas-ignore="true"
                  type="button"
                  onPointerDown={(event) => startResize(event, courseWidth, setCourseWidth, 150, 300)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") setCourseWidth((width) => Math.max(150, width - 10));
                    if (event.key === "ArrowRight") setCourseWidth((width) => Math.min(300, width + 10));
                  }}
                  className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-indigo-200/70 focus:bg-indigo-200/70"
                  aria-label={`担当枠列の幅を変更（現在${courseWidth}px）`}
                  title="ドラッグまたは左右キーで担当枠列幅を変更"
                />
              </div>
              {DAYS.map((day, index) => {
                const weekend = WEEKDAYS[index] === "土" ? "sat" : WEEKDAYS[index] === "日" ? "sun" : null;
                const shortage = dayShortage(day);
                return (
                  <div key={day} data-shift-export-sticky="true" className={cn("sticky top-0 z-40 h-16 border-b border-r border-slate-200 bg-slate-50 text-xs font-bold transition", selectedDay === day && "bg-indigo-50 text-indigo-700 ring-2 ring-inset ring-indigo-500", selectedDay !== day && weekend === "sat" && "text-blue-600", selectedDay !== day && weekend === "sun" && "text-rose-600")}>
                    <button data-shift-export-day="true" type="button" onClick={() => setSelectedDay(day)} className="flex h-full w-full flex-col items-center justify-center">
                      <span data-shift-export-day-number="true" className="text-sm">{day}日</span><span data-shift-export-day-weekday="true" className="text-[10px]">（{WEEKDAYS[index]}）</span>
                      {shortage > 0 && <span data-shift-export-pill="true" data-shift-export-day-shortage={day} className="mt-0.5 rounded-full bg-amber-100 px-1.5 text-[8px] font-bold leading-4 text-amber-700">不足{shortage}</span>}
                    </button>
                    <button
                      data-html2canvas-ignore="true"
                      type="button"
                      onPointerDown={(event) => startResize(event, dayWidth, setDayWidth, 56, 140)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") setDayWidth((width) => Math.max(56, width - 4));
                        if (event.key === "ArrowRight") setDayWidth((width) => Math.min(140, width + 4));
                      }}
                      className="group absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
                      aria-label={`日付列の幅を変更（現在${dayWidth}px）`}
                      title="ドラッグまたは左右キーですべての日付列幅を変更"
                    >
                      <span className="absolute bottom-2 right-0 top-2 w-px bg-transparent group-hover:bg-indigo-500 group-focus:bg-indigo-500" />
                    </button>
                  </div>
                );
              })}

              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-16 z-20 border-x-2 border-indigo-500"
                style={{ left: courseWidth + (selectedDay - 1) * dayWidth, width: dayWidth }}
              />

              {ROUTE_GROUPS.map((route) => (
                <div key={route.id} className="contents">
                  <div
                    data-export-route-header={route.id}
                    data-shift-export-sticky="true"
                    className={cn(
                      "sticky left-0 z-30 flex h-11 items-center gap-2 border-b border-r border-slate-200 bg-slate-100 px-3",
                      exportMode && exportSelection?.routeIds.includes(route.id) && "border-l-2 border-l-amber-500 bg-amber-50",
                    )}
                  >
                    <FontAwesomeIcon icon={faTruck} className="h-3 w-3 shrink-0 text-slate-400" />
                    <div data-shift-export-route-copy="true" className="min-w-0 flex-1 leading-tight">
                      <div data-shift-export-route-carrier="true" className="truncate text-[9px] font-medium text-slate-400">{route.carrier}</div>
                      <div data-shift-export-route-name="true" className="truncate text-[11px] font-bold text-slate-700">{route.name}</div>
                    </div>
                    <button type="button" data-html2canvas-ignore="true" data-route-add={route.id} onClick={(event) => openAddCourse(route, event)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`${route.name}に町名・担当枠を追加`} aria-haspopup="dialog" aria-expanded={addingRouteId === route.id} title="町名・担当枠を追加"><FontAwesomeIcon icon={faPlus} className="h-3 w-3" /></button>
                  </div>
                  <div className="h-11 border-b border-slate-200 bg-slate-100/80" style={{ gridColumn: `span ${DAYS.length}` }} />

                  {visibleCourses.filter((course) => course.routeId === route.id).map((course) => (
                    <div key={course.id} className="contents">
                      <div data-export-row={course.id} data-export-route-id={course.routeId} data-shift-export-sticky="true" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const sourceId = event.dataTransfer.getData(COURSE_DRAG_TYPE); if (sourceId) reorderCourse(sourceId, course.id); }} className="group/course sticky left-0 z-30 flex min-h-28 items-center gap-2 border-b border-r border-slate-200 bg-white px-2.5">
                        <button type="button" data-html2canvas-ignore="true" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(COURSE_DRAG_TYPE, course.id); }} className="inline-flex h-7 w-6 cursor-grab items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing" aria-label={`${course.name}を並べ替える`}><FontAwesomeIcon icon={faGripLines} className="h-3.5 w-3.5" /></button>
                        <span className="h-12 w-1 shrink-0 rounded-full" style={{ backgroundColor: course.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold leading-snug text-slate-700" title={course.name}>{course.name}</div>
                          <div className="mt-1 text-[9px] leading-tight text-slate-400">{weekdaySummary(course.activeWeekdays)}・{course.requiredCount}人</div>
                        </div>
                        <button type="button" data-html2canvas-ignore="true" onClick={(event) => openCourseSettings(course, event)} className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/95 text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-700" aria-label={`${course.name}を編集`} aria-haspopup="dialog" aria-expanded={settingsCourseId === course.id} title="担当枠を編集"><FontAwesomeIcon icon={faEllipsis} className="h-3 w-3" /></button>
                      </div>
                      {DAYS.map((day) => {
                        const key = cellKey(course.id, day);
                        const people = assignments[key] ?? [];
                        const active = isCourseActive(course, day);
                        const assignedCount = assignedPersonCount(people);
                        const shortage = shortageFor(course, day);
                        return (
                          <div
                            key={key}
                            onDragOver={(event) => { if (active) event.preventDefault(); }}
                            onDrop={(event) => { if (active) dropPerson(event, key); }}
                            onClick={() => setSelectedDay(day)}
                            className={cn("relative flex min-h-28 cursor-pointer flex-col content-start items-start gap-1.5 border-b border-r border-slate-200 p-1.5 pt-6 transition", active ? "hover:bg-slate-50" : "bg-slate-100/80", selectedDay === day && active && "bg-indigo-50/45")}
                            style={!active ? { backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(148,163,184,0.08) 8px, rgba(148,163,184,0.08) 10px)" } : undefined}
                          >
                            {active ? (
                              shortage > 0
                                ? <span data-shift-export-pill="true" className="absolute right-1.5 top-1.5 rounded-full bg-amber-100 px-1.5 text-[9px] font-bold leading-4 text-amber-700">あと{shortage}</span>
                                : <span data-shift-export-meta="true" className="absolute right-1.5 top-1.5 text-[9px] font-medium tabular-nums text-slate-400">{assignedCount}/{course.requiredCount}</span>
                            ) : (
                              <span data-shift-export-meta="true" className={cn("absolute right-1.5 top-1.5 text-[9px] font-medium", people.length > 0 ? "text-amber-700" : "text-slate-400")}>{people.length > 0 ? "非稼働に配置" : "非稼働"}</span>
                            )}
                            {people.map((name, personIndex) => (
                              <PersonSlip
                                key={`${name}-${personIndex}`}
                                name={name}
                                sourceKey={key}
                                selected={selectedToken?.name === name && selectedToken.sourceKey === key}
                                onSelect={selectPersonToken}
                                onRemove={() => removePerson(key, name)}
                              />
                            ))}
                            {active && people.length === 0 && <span className="m-auto text-base font-light text-slate-300">＋</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}

              {exportMode && (
                <div
                  ref={exportOverlayRef}
                  data-html2canvas-ignore="true"
                  className="absolute bottom-0 right-0 top-16 z-[60] touch-none cursor-crosshair select-none"
                  style={{ left: courseWidth }}
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
                    const left = exportSelection.x - courseWidth;
                    return (
                      <>
                        <div className="pointer-events-none absolute left-0 right-0 top-0 bg-slate-950/30" style={{ height: top }} />
                        <div className="pointer-events-none absolute left-0 bg-slate-950/30" style={{ top, width: left, height: exportSelection.height }} />
                        <div className="pointer-events-none absolute right-0 bg-slate-950/30" style={{ top, left: left + exportSelection.width, height: exportSelection.height }} />
                        <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-slate-950/30" style={{ top: top + exportSelection.height }} />
                        <div
                          className="pointer-events-none absolute border-y-2 border-l-2 border-amber-500 bg-amber-50/15"
                          style={{ left: -courseWidth, top, width: courseWidth, height: exportSelection.height }}
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

          <button
            type="button"
            onPointerDown={(event) => startResize(event, detailWidth, setDetailWidth, 280, 520, -1)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setDetailWidth((width) => Math.min(520, width + 10));
              if (event.key === "ArrowRight") setDetailWidth((width) => Math.max(280, width - 10));
            }}
            className="group relative cursor-col-resize bg-slate-100 hover:bg-indigo-200 focus:bg-indigo-200"
            aria-label={`右パネルの幅を変更（現在${detailWidth}px）`}
            title="ドラッグまたは左右キーで右パネル幅を変更"
          >
            <span className="absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-300 group-hover:bg-indigo-500" />
          </button>

          {exportMode ? (
            <aside className="min-h-0 overflow-y-auto border-l border-slate-200 bg-[#f8fafc]">
              <div className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[9px] font-bold tracking-[0.16em] text-amber-600">EXPORT</div>
                    <h2 className="mt-0.5 text-base font-black text-slate-900">範囲を切り取る</h2>
                  </div>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                    <FontAwesomeIcon icon={faCropSimple} className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
              <div className="space-y-4 p-3.5">
                <ol className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white text-[10px] font-bold">
                  <li className={cn("flex items-center gap-2 border-r border-slate-200 px-3 py-2.5", !exportSelection ? "bg-amber-50 text-amber-800" : "text-slate-500")}>
                    <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full", !exportSelection ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-500")}>1</span>
                    範囲を選択
                  </li>
                  <li className={cn("flex items-center gap-2 px-3 py-2.5", exportSelection ? "bg-amber-50 text-amber-800" : "text-slate-400")}>
                    <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full", exportSelection ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-400")}>2</span>
                    形式を選んで保存
                  </li>
                </ol>

                {!exportSelection ? (
                  <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4 text-center">
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
                              const range = exportDayRange(exportSelection, courseWidth, dayWidth);
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
                    </div>
                  </>
                )}

                {exportError && (
                  <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-medium text-rose-700">{exportError}</p>
                )}
              </div>
            </aside>
          ) : (
          <aside className="min-h-0 overflow-y-auto border-l border-slate-200 bg-slate-50/70">
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
              <h2 className="text-lg font-black text-slate-900">2026年8月{selectedDay}日（{WEEKDAYS[selectedDay - 1]}）</h2>
            </div>
            <div className="space-y-4 p-3.5">
              {selectedShortages.length > 0 ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold text-amber-900">不足している担当枠</h3>
                    <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-bold text-amber-800">あと{selectedShortages.reduce((total, entry) => total + entry.shortage, 0)}人</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedShortages.map(({ course, shortage }) => (
                      <span key={course.id} className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700">{course.name} <span className="text-amber-700">あと{shortage}</span></span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section onDragOver={(event) => event.preventDefault()} onDrop={returnPersonToRack} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">名前札</span>
                </div>
                <div className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5"><FontAwesomeIcon icon={faMagnifyingGlass} className="h-3 w-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名前を検索" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>
                <div className="flex min-h-11 max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-1.5">{filteredPeople.map((name) => <PersonSlip key={name} name={name} selected={selectedToken?.name === name && !selectedToken.sourceKey} onSelect={selectPersonToken} />)}</div>
                <div className="mt-2 flex h-8 items-center rounded-lg border border-dashed border-slate-300 pl-2.5">
                  <input value={customName} onChange={(event) => setCustomName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCustomName()} placeholder="応援1名・未定など" className="min-w-0 flex-1 text-xs outline-none" />
                  <button type="button" onClick={addCustomName} className="inline-flex h-full items-center gap-1 px-2 text-[10px] font-medium text-slate-600 hover:bg-slate-50"><FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" />文字札</button>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-600">この日の配置</h3><span className="text-[10px] text-slate-400">{selectedAssignments.reduce((sum, entry) => sum + entry.people.length, 0)}枚</span></div>
                {selectedAssignments.map(({ course, people }) => {
                  const key = cellKey(course.id, selectedDay);
                  const active = isCourseActive(course, selectedDay);
                  const shortage = shortageFor(course, selectedDay);
                  return (
                    <div
                      key={course.id}
                      role="group"
                      tabIndex={active ? 0 : undefined}
                      aria-label={`${course.name}の配置先${selectedToken ? `。${selectedToken.name}を配置するにはEnterキー` : ""}`}
                      onKeyDown={(event) => {
                        if (active && selectedToken && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          requestPersonPlacement(selectedToken, key);
                        }
                      }}
                      onDragOver={(event) => { if (active) event.preventDefault(); }}
                      onDrop={(event) => { if (active) dropPerson(event, key); }}
                      className={cn("rounded-lg border p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500", active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100/80")}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-4 w-1 rounded-full" style={{ backgroundColor: course.color }} />
                        <div className="min-w-0 flex-1"><div className="truncate text-[9px] text-slate-400">{ROUTE_GROUPS.find((route) => route.id === course.routeId)?.name}・必要{course.requiredCount}人</div><h4 className="truncate text-[11px] font-bold text-slate-700">{course.name}</h4></div>
                        {!active ? <span className="text-[9px] font-medium text-slate-400">非稼働</span> : shortage > 0 ? <span className="rounded-full bg-amber-100 px-1.5 text-[9px] font-bold leading-4 text-amber-700">あと{shortage}</span> : null}
                      </div>
                      <div className={cn("flex min-h-8 flex-wrap gap-1.5 rounded-md border border-dashed p-1.5", active ? "border-slate-200 bg-slate-50/50" : "border-slate-200 bg-slate-100")}>
                        {people.map((name, index) => (
                          <PersonSlip
                            key={`${name}-${index}`}
                            name={name}
                            sourceKey={key}
                            selected={selectedToken?.name === name && selectedToken.sourceKey === key}
                            onSelect={selectPersonToken}
                            onRemove={() => removePerson(key, name)}
                          />
                        ))}
                        {people.length === 0 && <span className="m-auto text-[10px] text-slate-300">{active ? "＋" : "非稼働"}</span>}
                      </div>
                    </div>
                  );
                })}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-3">
                <label className="mb-1.5 block text-xs font-bold text-slate-700">この日のメモ</label>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-slate-400" />
              </section>
            </div>
          </aside>
          )}
        </div>
      </div>

      {activePanel?.kind === "add" && activeRoute && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={() => closeActivePanel(true)} />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`${activeRoute.name}に担当枠を追加`}
            onKeyDown={(event) => trapDialogFocus(event, () => closeActivePanel(true))}
            className="fixed z-[100] rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xl"
            style={floatingPanelPosition(activePanel.anchor, 256, 92)}
          >
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="new-assignment-name" className="text-[10px] font-bold text-slate-600">{activeRoute.name}に担当枠を追加</label>
              <button type="button" onClick={() => closeActivePanel(true)} className="text-[10px] text-slate-400 hover:text-slate-700">閉じる</button>
            </div>
            <div className="flex h-8 overflow-hidden rounded-lg border border-slate-200 focus-within:border-indigo-400">
              <input id="new-assignment-name" autoFocus value={newCourseName} onChange={(event) => setNewCourseName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addCourse(activeRoute); }} placeholder="町名・エリア名・作業名" className="min-w-0 flex-1 px-2 text-[11px] outline-none" />
              <button type="button" onClick={() => addCourse(activeRoute)} className="border-l border-slate-200 bg-slate-800 px-3 text-[10px] font-semibold text-white hover:bg-slate-700">追加</button>
            </div>
          </section>
        </>,
        document.body,
      )}

      {activePanel?.kind === "edit" && activeCourse && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={() => closeActivePanel(true)} />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-editor-title"
            onKeyDown={(event) => trapDialogFocus(event, () => closeActivePanel(true))}
            className="fixed z-[100] rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xl"
            style={floatingPanelPosition(activePanel.anchor, 320, 218)}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div id="assignment-editor-title" className="text-[10px] font-bold text-slate-700">担当枠を編集</div>
              <button type="button" onClick={() => closeActivePanel(true)} className="text-[10px] text-slate-400 hover:text-slate-700">閉じる</button>
            </div>
            <input autoFocus value={settingsCourseName} onChange={(event) => setSettingsCourseName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCourseSettings(activeCourse.id); }} className="mb-2 h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-indigo-400" aria-label="担当枠名" />
            <div className="mb-2 grid grid-cols-[1fr_auto] items-end gap-2">
              <div>
                <div className="mb-1 text-[9px] font-medium text-slate-500">稼働曜日</div>
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAY_OPTIONS.map((weekday) => {
                    const active = settingsWeekdays.includes(weekday.value);
                    return (
                      <button key={weekday.value} type="button" aria-pressed={active} onClick={() => setSettingsWeekdays((current) => active ? current.filter((value) => value !== weekday.value) : [...current, weekday.value])} className={cn("h-7 rounded-md border text-[10px] font-bold", active ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-400 hover:border-slate-400")}>{weekday.label}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-1 text-center text-[9px] font-medium text-slate-500">必要人数</div>
                <div className="flex h-7 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  <button type="button" onClick={() => setSettingsRequiredCount((count) => Math.max(1, count - 1))} className="h-full w-7 text-sm text-slate-500 hover:bg-slate-100" aria-label="必要人数を減らす">−</button>
                  <span className="w-7 text-center text-xs font-bold tabular-nums text-slate-800">{settingsRequiredCount}</span>
                  <button type="button" onClick={() => setSettingsRequiredCount((count) => Math.min(10, count + 1))} className="h-full w-7 text-sm text-slate-500 hover:bg-slate-100" aria-label="必要人数を増やす">＋</button>
                </div>
              </div>
            </div>
            {(settingsWeekdays.length === 0 || !settingsCourseName.trim()) && (
              <p className="mb-2 text-[9px] text-rose-600">名前と稼働日を設定してください</p>
            )}
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => hideCourse(activeCourse)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[9px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"><FontAwesomeIcon icon={faEyeSlash} className="h-2.5 w-2.5" />非表示</button>
              <button type="button" disabled={settingsWeekdays.length === 0 || !settingsCourseName.trim()} onClick={() => saveCourseSettings(activeCourse.id)} className="h-8 min-w-28 rounded-lg bg-slate-900 px-4 text-[10px] font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40">設定を反映</button>
            </div>
          </section>
        </>,
        document.body,
      )}

      {pendingDuplicate && (() => {
        const targetCourseId = pendingDuplicate.targetKey.split(":")[0];
        const targetDay = Number(pendingDuplicate.targetKey.split(":").at(-1));
        const targetCourseName = courses.find((course) => course.id === targetCourseId)?.name ?? "選択した担当枠";
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={() => setPendingDuplicate(null)}>
            <section role="alertdialog" aria-modal="true" aria-labelledby="duplicate-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => trapDialogFocus(event, () => setPendingDuplicate(null))}>
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><FontAwesomeIcon icon={faTriangleExclamation} className="h-4 w-4" /></span>
                <div>
                  <h2 id="duplicate-title" className="text-sm font-black text-slate-900">同じ日に配置済みです</h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    {pendingDuplicate.token.name}さんは2026年8月{targetDay}日に「{pendingDuplicate.existingCourseNames.join("」「")}」へ置かれています。「{targetCourseName}」にも置きますか？
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button autoFocus type="button" onClick={() => setPendingDuplicate(null)} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">キャンセル</button>
                <button type="button" onClick={() => { applyPersonDrop(pendingDuplicate.token, pendingDuplicate.targetKey); setPendingDuplicate(null); }} className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-700">それでも配置</button>
              </div>
            </section>
          </div>
        );
      })()}
    </main>
  );
}
