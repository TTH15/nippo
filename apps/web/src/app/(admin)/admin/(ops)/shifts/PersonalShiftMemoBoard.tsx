"use client";

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
  faChevronDown,
  faEllipsis,
  faEye,
  faEyeSlash,
  faGripLines,
  faLock,
  faMagnifyingGlass,
  faMinus,
  faPlus,
  faRotateLeft,
  faTriangleExclamation,
  faTruck,
} from "@fortawesome/free-solid-svg-icons";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { cn } from "@/lib/ui/utils";

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

type AssignmentLane = {
  id: string;
  routeId: string;
  name: string;
  color: string;
  activeWeekdays: number[];
  requiredCount: number;
  custom: boolean;
};

type AssignedPerson = {
  placementId: string;
  personKey: string;
  driverId?: string;
  name: string;
};

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
  | null;

type StoredBoard = {
  version: 1;
  lanes: AssignmentLane[];
  laneOrder: string[];
  hiddenLaneIds: string[];
  assignments: Record<string, AssignedPerson[]>;
  extraPeople: string[];
  notes: Record<string, string>;
  widths?: { day: number; lane: number; detail: number };
};

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
const LANE_DRAG_TYPE = "application/x-hakotora-personal-shift-memo-lane";

function cellKey(laneId: string, date: string): string {
  return `${laneId}|${date}`;
}

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

function activeOn(lane: AssignmentLane, date: string): boolean {
  return lane.activeWeekdays.includes(dateInfo(date).weekdayNo);
}

function assignedCount(people: AssignedPerson[]): number {
  return new Set(people.map((person) => person.personKey)).size;
}

function shortageFor(lane: AssignmentLane, date: string, people: AssignedPerson[]): number {
  return activeOn(lane, date) ? Math.max(0, lane.requiredCount - assignedCount(people)) : 0;
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
  onSelect,
  onRemove,
}: {
  token: PersonToken;
  code?: string | null;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      aria-pressed={selected}
      title={code ? `${token.name}（${code}）` : token.name}
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
      )}
      style={{ borderLeftColor: colorForPerson(token.personKey), borderLeftWidth: 3 }}
    >
      <span className="min-w-0 truncate px-2 py-1">{token.name}</span>
      {code && !token.sourceKey && <span className="shrink-0 border-l border-slate-100 px-1.5 py-1 font-mono text-[8px] text-slate-400">{code}</span>}
    </button>
  );
}

export default function PersonalShiftMemoBoard({
  dates,
  courses,
  drivers,
  today,
}: {
  dates: string[];
  courses: MemoCourse[];
  drivers: MemoDriver[];
  today: string;
}) {
  const viewerId = getStoredDriver()?.id ?? "local";
  // 担当枠設定は期間をまたいで使い回し、配置と日別メモはISO日付キーで同じ個人領域へ蓄積する。
  const storageKey = `hakotora_personal_shift_memo_v1:${viewerId}`;
  const initialLanes = useMemo(() => defaultLanes(courses), [courses]);
  const [invoiceAddressNames, setInvoiceAddressNames] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dates.includes(today) ? today : dates[0] ?? "");
  const [dayWidth, setDayWidth] = useState(76);
  const [laneWidth, setLaneWidth] = useState(190);
  const [detailWidth, setDetailWidth] = useState(330);
  const [lanes, setLanes] = useState<AssignmentLane[]>(initialLanes);
  const [laneOrder, setLaneOrder] = useState<string[]>(initialLanes.map((lane) => lane.id));
  const [hiddenLaneIds, setHiddenLaneIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, AssignedPerson[]>>({});
  const [extraPeople, setExtraPeople] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredBoard>;
        if (stored.version === 1 && Array.isArray(stored.lanes)) {
          const knownIds = new Set(stored.lanes.map((lane) => lane.id));
          const mergedLanes = [...stored.lanes, ...initialLanes.filter((lane) => !knownIds.has(lane.id))];
          setLanes(mergedLanes);
          setLaneOrder([
            ...(stored.laneOrder ?? []).filter((id) => mergedLanes.some((lane) => lane.id === id)),
            ...mergedLanes.map((lane) => lane.id).filter((id) => !(stored.laneOrder ?? []).includes(id)),
          ]);
          setHiddenLaneIds(Array.isArray(stored.hiddenLaneIds) ? stored.hiddenLaneIds : []);
          setAssignments(stored.assignments && typeof stored.assignments === "object" ? stored.assignments : {});
          setExtraPeople(Array.isArray(stored.extraPeople) ? stored.extraPeople : []);
          setNotes(stored.notes && typeof stored.notes === "object" ? stored.notes : {});
          if (stored.widths) {
            setDayWidth(Math.max(56, Math.min(140, stored.widths.day || 76)));
            setLaneWidth(Math.max(150, Math.min(300, stored.widths.lane || 190)));
            setDetailWidth(Math.max(280, Math.min(520, stored.widths.detail || 330)));
          }
        }
      }
    } catch {
      setSaveError("この端末に保存したメモを読み込めませんでした");
    } finally {
      setHydrated(true);
    }
  }, [initialLanes, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const board: StoredBoard = {
        version: 1,
        lanes,
        laneOrder,
        hiddenLaneIds,
        assignments,
        extraPeople,
        notes,
        widths: { day: dayWidth, lane: laneWidth, detail: detailWidth },
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(board));
        setSaveError(null);
        setSavedAt(Date.now());
      } catch {
        setSaveError("端末へ保存できませんでした。ブラウザの保存容量を確認してください");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [assignments, dayWidth, detailWidth, extraPeople, hiddenLaneIds, hydrated, laneOrder, laneWidth, lanes, notes, storageKey]);

  useEffect(() => {
    if (!activePanel) return;
    const closeOnScroll = () => {
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

  const orderedLanes = useMemo(() => {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    const routeIds = new Set(routeGroups.map((route) => route.id));
    return laneOrder
      .map((id) => byId.get(id))
      .filter((lane): lane is AssignmentLane => !!lane && routeIds.has(lane.routeId));
  }, [laneOrder, lanes, routeGroups]);
  const visibleLanes = orderedLanes.filter((lane) => !hiddenLaneIds.includes(lane.id));
  const hiddenLanes = orderedLanes.filter((lane) => hiddenLaneIds.includes(lane.id));
  const filteredDrivers = drivers.filter((driver) => {
    const query = search.trim().toLocaleLowerCase("ja-JP");
    return !query || `${getDisplayName(driver)} ${driver.driver_code ?? ""}`.toLocaleLowerCase("ja-JP").includes(query);
  });
  const boardWidth = laneWidth + dayWidth * dates.length;
  const activeLane = activePanel?.kind === "edit" ? lanes.find((lane) => lane.id === activePanel.laneId) : undefined;
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

  const selectToken = (token: PersonToken) => {
    const same = selectedToken?.personKey === token.personKey && selectedToken.placementId === token.placementId;
    setSelectedToken(same ? null : token);
    setLiveMessage(same ? `${token.name}の選択を解除しました` : `${token.name}を選択しました`);
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

  const saveLaneSettings = (laneId: string) => {
    const name = settingsName.trim().slice(0, 30);
    if (!name || settingsWeekdays.length === 0) return;
    setLanes((current) => current.map((lane) => lane.id === laneId ? {
      ...lane,
      name,
      activeWeekdays: [...settingsWeekdays].sort((a, b) => a - b),
      requiredCount: Math.max(1, Math.min(10, settingsRequiredCount)),
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

  const selectedAssignments = visibleLanes.map((lane) => ({
    lane,
    people: assignments[cellKey(lane.id, selectedDate)] ?? [],
  }));
  const selectedShortages = selectedAssignments
    .map((entry) => ({ ...entry, shortage: shortageFor(entry.lane, selectedDate, entry.people) }))
    .filter((entry) => entry.shortage > 0);
  const dayShortage = (date: string) => visibleLanes.reduce((sum, lane) => {
    const people = assignments[cellKey(lane.id, date)] ?? [];
    return sum + shortageFor(lane, date, people);
  }, 0);

  if (!hydrated) {
    return <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />;
  }

  return (
    <div className="space-y-3 pb-8 text-slate-900">
      <p className="sr-only" aria-live="polite">{liveMessage}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
          <FontAwesomeIcon icon={faLock} className="h-3 w-3" />個人メモ
        </span>
        <span className="text-[11px] text-slate-500">
          {saveError ? <span className="text-rose-600">{saveError}</span> : savedAt ? "この端末に自動保存済み" : "この端末に保存"}
        </span>
        {hiddenLanes.length > 0 && (
          <button type="button" onClick={() => setHiddenOpen((open) => !open)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600 hover:border-slate-400">
            <FontAwesomeIcon icon={faEye} className="h-3 w-3" />非表示 {hiddenLanes.length}件
            <FontAwesomeIcon icon={faChevronDown} className={cn("h-2.5 w-2.5 transition-transform", hiddenOpen && "rotate-180")} />
          </button>
        )}
      </div>

      {hiddenOpen && hiddenLanes.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          {hiddenLanes.map((lane) => (
            <button key={lane.id} type="button" onClick={() => setHiddenLaneIds((ids) => ids.filter((id) => id !== lane.id))} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2 text-[10px] font-medium text-slate-700 hover:border-amber-400">
              <span className="h-3 w-1 rounded-full" style={{ backgroundColor: lane.color }} />{lane.name}
              <FontAwesomeIcon icon={faRotateLeft} className="h-2.5 w-2.5 text-amber-600" />
            </button>
          ))}
          <button type="button" onClick={() => setHiddenLaneIds([])} className="ml-auto text-[10px] font-medium text-amber-700 hover:underline">すべて表示へ戻す</button>
        </section>
      )}

      <div
        inert={activePanel !== null || pendingDuplicate !== null ? true : undefined}
        aria-hidden={activePanel !== null || pendingDuplicate !== null ? true : undefined}
        className="grid min-h-[680px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-250px)] lg:grid-cols-[minmax(0,1fr)_7px_var(--memo-detail-width)]"
        style={{ "--memo-detail-width": `${detailWidth}px` } as React.CSSProperties}
      >
        <section className="min-h-[480px] min-w-0 overflow-auto bg-white lg:min-h-0">
          <div className="relative grid min-h-full content-start" style={{ gridTemplateColumns: `${laneWidth}px repeat(${dates.length}, ${dayWidth}px)`, width: boardWidth }}>
            <div className="sticky left-0 top-0 z-50 flex h-16 items-center border-b border-r border-slate-200 bg-slate-50 px-3">
              <span className="text-xs font-bold text-slate-600">町名・担当枠</span>
              <button type="button" onPointerDown={(event) => startResize(event, laneWidth, setLaneWidth, 150, 300)} className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-indigo-200/70" aria-label={`担当枠列の幅を変更（現在${laneWidth}px）`} />
            </div>
            {dates.map((date) => {
              const info = dateInfo(date);
              const shortage = dayShortage(date);
              return (
                <div key={date} className={cn("sticky top-0 z-40 h-16 border-b border-r border-slate-200 bg-slate-50 text-xs font-bold", selectedDate === date && "bg-indigo-50 text-indigo-700 ring-2 ring-inset ring-indigo-500", selectedDate !== date && info.weekdayNo === 6 && "text-blue-600", selectedDate !== date && info.weekdayNo === 0 && "text-rose-600")}>
                  <button type="button" onClick={() => setSelectedDate(date)} className="flex h-full w-full flex-col items-center justify-center">
                    <span className="text-sm">{info.day}日</span><span className="text-[10px]">（{info.weekday}）</span>
                    {shortage > 0 && <span className="mt-0.5 rounded-full bg-amber-100 px-1.5 text-[8px] font-bold leading-4 text-amber-700">不足{shortage}</span>}
                  </button>
                  <button type="button" onPointerDown={(event) => startResize(event, dayWidth, setDayWidth, 56, 140)} className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize" aria-label={`日付列の幅を変更（現在${dayWidth}px）`} />
                </div>
              );
            })}

            <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-16 z-20 border-x-2 border-indigo-500" style={{ left: laneWidth + dates.indexOf(selectedDate) * dayWidth, width: dayWidth }} />

            {routeGroups.map((route) => {
              const routeLanes = visibleLanes.filter((lane) => lane.routeId === route.id);
              return (
                <div key={route.id} className="contents">
                  <div className="sticky left-0 z-30 flex h-11 items-center gap-2 border-b border-r border-slate-200 bg-slate-100 px-3">
                    <FontAwesomeIcon icon={faTruck} className="h-3 w-3 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[9px] text-slate-400">{route.carrier}</div><div className="truncate text-xs font-bold text-slate-700">{route.name}</div></div>
                    <button type="button" data-route-add={route.id} onClick={(event) => openAddLane(route, event)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`${route.name}に担当枠を追加`} aria-haspopup="dialog"><FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="h-11 border-b border-slate-200 bg-slate-100/80" style={{ gridColumn: `span ${dates.length}` }} />

                  {routeLanes.map((lane) => (
                    <div key={lane.id} className="contents">
                      <div
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData(LANE_DRAG_TYPE, lane.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => reorderLane(event.dataTransfer.getData(LANE_DRAG_TYPE), lane.id)}
                        className="sticky left-0 z-30 flex min-h-28 items-center gap-2 border-b border-r border-slate-200 bg-white px-2.5"
                      >
                        <FontAwesomeIcon icon={faGripLines} className="h-3 w-3 shrink-0 cursor-grab text-slate-300" />
                        <span className="h-12 w-1 shrink-0 rounded-full" style={{ backgroundColor: lane.color }} />
                        <div className="min-w-0 flex-1"><div className="text-xs font-bold leading-snug text-slate-700">{lane.name}</div><div className="mt-1 text-[9px] text-slate-400">{weekdaySummary(lane.activeWeekdays)}・{lane.requiredCount}人</div></div>
                        <button type="button" onClick={(event) => openLaneSettings(lane, event)} className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 hover:text-slate-700" aria-label={`${lane.name}を編集`} aria-haspopup="dialog"><FontAwesomeIcon icon={faEllipsis} className="h-3 w-3" /></button>
                      </div>
                      {dates.map((date) => {
                        const key = cellKey(lane.id, date);
                        const people = assignments[key] ?? [];
                        const active = activeOn(lane, date);
                        const shortage = shortageFor(lane, date, people);
                        return (
                          <div
                            key={key}
                            role="group"
                            tabIndex={active ? 0 : undefined}
                            onKeyDown={(event) => {
                              if (active && selectedToken && (event.key === "Enter" || event.key === " ")) {
                                event.preventDefault();
                                requestPlacement(selectedToken, key);
                              }
                            }}
                            onDragOver={(event) => { if (active) event.preventDefault(); }}
                            onDrop={(event) => { if (active) dropPerson(event, key); }}
                            onClick={() => setSelectedDate(date)}
                            className={cn("relative flex min-h-28 flex-col content-start items-start gap-1.5 border-b border-r border-slate-200 p-1.5 pt-6 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500", active ? "hover:bg-slate-50" : "bg-slate-100/80", selectedDate === date && active && "bg-indigo-50/45")}
                            style={!active ? { backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(148,163,184,0.08) 8px, rgba(148,163,184,0.08) 10px)" } : undefined}
                          >
                            {active ? shortage > 0
                              ? <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-100 px-1.5 text-[9px] font-bold leading-4 text-amber-700">あと{shortage}</span>
                              : <span className="absolute right-1.5 top-1.5 text-[9px] text-slate-400">{assignedCount(people)}/{lane.requiredCount}</span>
                              : <span className="absolute right-1.5 top-1.5 text-[9px] text-slate-400">非稼働</span>}
                            {people.map((person) => {
                              const token: PersonToken = { personKey: person.personKey, driverId: person.driverId, name: person.name, sourceKey: key, placementId: person.placementId };
                              return <PersonSlip key={person.placementId} token={token} selected={selectedToken?.placementId === person.placementId} onSelect={() => selectToken(token)} onRemove={() => removePerson(key, person.placementId, person.name)} />;
                            })}
                            {active && people.length === 0 && <span className="m-auto text-base font-light text-slate-300">＋</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <button type="button" onPointerDown={(event) => startResize(event, detailWidth, setDetailWidth, 280, 520, -1)} className="group relative hidden cursor-col-resize bg-slate-100 hover:bg-indigo-200 lg:block" aria-label={`右パネルの幅を変更（現在${detailWidth}px）`}><span className="absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-300" /></button>

        <aside className="min-h-0 border-t border-slate-200 bg-slate-50/70 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <h2 className="text-lg font-black text-slate-900">{dateInfo(selectedDate).monthDay}（{dateInfo(selectedDate).weekday}）</h2>
          </div>
          <div className="space-y-4 p-3.5">
            {selectedShortages.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold text-amber-900">不足している担当枠</h3><span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-bold text-amber-800">あと{selectedShortages.reduce((sum, entry) => sum + entry.shortage, 0)}人</span></div><div className="mt-2 flex flex-wrap gap-1.5">{selectedShortages.map(({ lane, shortage }) => <span key={lane.id} className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700">{lane.name} <span className="text-amber-700">あと{shortage}</span></span>)}</div></section>
            )}

            <section onDragOver={(event) => event.preventDefault()} onDrop={returnPersonToRack} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <h3 className="mb-2 text-xs font-bold text-slate-700">名前札</h3>
              <div className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5"><FontAwesomeIcon icon={faMagnifyingGlass} className="h-3 w-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名前・コードで検索" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>
              <div className="flex min-h-11 max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-1.5">
                {filteredDrivers.map((driver) => {
                  const token: PersonToken = { personKey: `driver:${driver.id}`, driverId: driver.id, name: getDisplayName(driver) };
                  return <PersonSlip key={driver.id} token={token} code={driver.driver_code} selected={selectedToken?.personKey === token.personKey && !selectedToken.sourceKey} onSelect={() => selectToken(token)} />;
                })}
                {extraPeople.map((name) => {
                  const token: PersonToken = { personKey: `custom:${name}`, name };
                  return <PersonSlip key={token.personKey} token={token} selected={selectedToken?.personKey === token.personKey && !selectedToken.sourceKey} onSelect={() => selectToken(token)} />;
                })}
              </div>
              <div className="mt-2 flex h-8 items-center rounded-lg border border-dashed border-slate-300 pl-2.5"><input value={customName} onChange={(event) => setCustomName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) addCustomPerson(); }} placeholder="応援1名・未定など" className="min-w-0 flex-1 text-xs outline-none" /><button type="button" onClick={addCustomPerson} className="inline-flex h-full items-center gap-1 px-2 text-[10px] font-medium text-slate-600 hover:bg-slate-50"><FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" />文字札</button></div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-600">この日の配置</h3><span className="text-[10px] text-slate-400">{selectedAssignments.reduce((sum, entry) => sum + entry.people.length, 0)}枚</span></div>
              {selectedAssignments.map(({ lane, people }) => {
                const key = cellKey(lane.id, selectedDate);
                const active = activeOn(lane, selectedDate);
                const shortage = shortageFor(lane, selectedDate, people);
                return (
                  <div key={lane.id} role="group" tabIndex={active ? 0 : undefined} onKeyDown={(event) => { if (active && selectedToken && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); requestPlacement(selectedToken, key); } }} onDragOver={(event) => { if (active) event.preventDefault(); }} onDrop={(event) => { if (active) dropPerson(event, key); }} className={cn("rounded-lg border p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500", active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100/80")}>
                    <div className="mb-2 flex items-center gap-2"><span className="h-4 w-1 rounded-full" style={{ backgroundColor: lane.color }} /><div className="min-w-0 flex-1"><div className="truncate text-[9px] text-slate-400">{routeGroups.find((route) => route.id === lane.routeId)?.name}・必要{lane.requiredCount}人</div><h4 className="truncate text-[11px] font-bold text-slate-700">{lane.name}</h4></div>{!active ? <span className="text-[9px] text-slate-400">非稼働</span> : shortage > 0 ? <span className="rounded-full bg-amber-100 px-1.5 text-[9px] font-bold leading-4 text-amber-700">あと{shortage}</span> : null}</div>
                    <div className="flex min-h-8 flex-wrap gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-1.5">{people.map((person) => { const token: PersonToken = { personKey: person.personKey, driverId: person.driverId, name: person.name, sourceKey: key, placementId: person.placementId }; return <PersonSlip key={person.placementId} token={token} selected={selectedToken?.placementId === person.placementId} onSelect={() => selectToken(token)} onRemove={() => removePerson(key, person.placementId, person.name)} />; })}</div>
                  </div>
                );
              })}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-3"><label className="mb-1.5 block text-xs font-bold text-slate-700">この日のメモ</label><textarea value={notes[selectedDate] ?? ""} maxLength={2000} onChange={(event) => setNotes((current) => ({ ...current, [selectedDate]: event.target.value }))} rows={4} className="w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-slate-400" /></section>
          </div>
        </aside>
      </div>

      {activePanel?.kind === "add" && activeRoute && createPortal(
        <><div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={() => closeActivePanel(true)} /><section role="dialog" aria-modal="true" aria-label={`${activeRoute.name}に担当枠を追加`} onKeyDown={(event) => trapDialogFocus(event, () => closeActivePanel(true))} className="fixed z-[100] rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xl" style={floatingPanelPosition(activePanel.anchor, 256, 92)}><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor="personal-memo-new-lane" className="text-[10px] font-bold text-slate-600">{activeRoute.name}に担当枠を追加</label><button type="button" onClick={() => closeActivePanel(true)} className="text-[10px] text-slate-400 hover:text-slate-700">閉じる</button></div><div className="flex h-8 overflow-hidden rounded-lg border border-slate-200"><input id="personal-memo-new-lane" autoFocus value={newLaneName} onChange={(event) => setNewLaneName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addLane(activeRoute); }} placeholder="町名・エリア名・作業名" className="min-w-0 flex-1 px-2 text-[11px] outline-none" /><button type="button" onClick={() => addLane(activeRoute)} className="border-l border-slate-200 bg-slate-800 px-3 text-[10px] font-semibold text-white">追加</button></div></section></>,
        document.body,
      )}

      {activePanel?.kind === "edit" && activeLane && createPortal(
        <><div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={() => closeActivePanel(true)} /><section role="dialog" aria-modal="true" aria-labelledby="personal-memo-lane-editor" onKeyDown={(event) => trapDialogFocus(event, () => closeActivePanel(true))} className="fixed z-[100] rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xl" style={floatingPanelPosition(activePanel.anchor, 320, 218)}><div className="mb-2 flex items-center justify-between gap-3"><div id="personal-memo-lane-editor" className="text-[10px] font-bold text-slate-700">担当枠を編集</div><button type="button" onClick={() => closeActivePanel(true)} className="text-[10px] text-slate-400">閉じる</button></div><input autoFocus value={settingsName} onChange={(event) => setSettingsName(event.target.value)} className="mb-2 h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold outline-none" aria-label="担当枠名" /><div className="mb-2 grid grid-cols-[1fr_auto] items-end gap-2"><div><div className="mb-1 text-[9px] text-slate-500">稼働曜日</div><div className="grid grid-cols-7 gap-1">{WEEKDAY_OPTIONS.map((weekday) => { const active = settingsWeekdays.includes(weekday.value); return <button key={weekday.value} type="button" aria-pressed={active} onClick={() => setSettingsWeekdays((current) => active ? current.filter((value) => value !== weekday.value) : [...current, weekday.value])} className={cn("h-7 rounded-md border text-[10px] font-bold", active ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-400")}>{weekday.label}</button>; })}</div></div><div><div className="mb-1 text-center text-[9px] text-slate-500">必要人数</div><div className="flex h-7 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50"><button type="button" onClick={() => setSettingsRequiredCount((count) => Math.max(1, count - 1))} className="h-full w-7 text-slate-500" aria-label="必要人数を減らす"><FontAwesomeIcon icon={faMinus} className="h-2.5 w-2.5" /></button><span className="w-7 text-center text-xs font-bold">{settingsRequiredCount}</span><button type="button" onClick={() => setSettingsRequiredCount((count) => Math.min(10, count + 1))} className="h-full w-7 text-slate-500" aria-label="必要人数を増やす"><FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" /></button></div></div></div><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => { setHiddenLaneIds((ids) => ids.includes(activeLane.id) ? ids : [...ids, activeLane.id]); setActivePanel(null); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[9px] text-slate-400 hover:bg-slate-100"><FontAwesomeIcon icon={faEyeSlash} className="h-2.5 w-2.5" />非表示</button><button type="button" disabled={!settingsName.trim() || settingsWeekdays.length === 0} onClick={() => saveLaneSettings(activeLane.id)} className="h-8 min-w-28 rounded-lg bg-slate-900 px-4 text-[10px] font-semibold text-white disabled:opacity-40">設定を反映</button></div></section></>,
        document.body,
      )}

      {pendingDuplicate && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={() => setPendingDuplicate(null)}><section role="alertdialog" aria-modal="true" aria-labelledby="personal-memo-duplicate" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => trapDialogFocus(event, () => setPendingDuplicate(null))}><div className="flex items-start gap-3"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><FontAwesomeIcon icon={faTriangleExclamation} className="h-4 w-4" /></span><div><h2 id="personal-memo-duplicate" className="text-sm font-black text-slate-900">同じ日に配置済みです</h2><p className="mt-2 text-xs leading-relaxed text-slate-600">{pendingDuplicate.token.name}さんは「{pendingDuplicate.existingNames.join("」「")}」へ置かれています。この担当枠にも置きますか？</p></div></div><div className="mt-5 flex justify-end gap-2"><button autoFocus type="button" onClick={() => setPendingDuplicate(null)} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600">キャンセル</button><button type="button" onClick={() => { applyPersonDrop(pendingDuplicate.token, pendingDuplicate.targetKey); setPendingDuplicate(null); }} className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white">それでも配置</button></div></section></div>,
        document.body,
      )}
    </div>
  );
}
