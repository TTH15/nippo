"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowPointer,
  faExpand,
  faGripVertical,
  faMagnifyingGlass,
  faNoteSticky,
  faPlus,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { Skeleton } from "@/lib/components/Skeleton";
import { cn } from "@/lib/ui/utils";
import { useApi } from "@/lib/useApi";
import type { ShiftMemoDay, ShiftMemoPlacement } from "@/server/shiftMemos/schema";

type MemoCourse = {
  id: string;
  name: string;
  summary_title?: string | null;
  color: string;
  uses_cycles?: boolean | null;
  course_cycles?: {
    cycle_no: number;
    label?: string | null;
    active?: boolean | null;
  }[] | null;
};

type MemoDriver = {
  id: string;
  name: string;
  display_name?: string | null;
};

type MemoLane = {
  key: string;
  courseId: string;
  cycleNo: number;
  label: string;
  color: string;
};

type MemoToken =
  | { kind: "driver"; driverId: string; label: string }
  | { kind: "custom"; label: string }
  | { kind: "placement"; id: string };

type MemoResponse = { days: ShiftMemoDay[]; unavailable?: boolean };

const MEMO_DRAG_TYPE = "application/x-hakotora-shift-memo";

function laneKey(courseId: string, cycleNo: number): string {
  return `${courseId}:${cycleNo}`;
}

function createPlacementId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `memo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatMemoDate(date: string): { day: string; weekday: string; weekend: "sun" | "sat" | null } {
  const value = new Date(`${date}T12:00:00`);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const weekdayNo = value.getDay();
  return {
    day: String(value.getDate()),
    weekday: weekdays[weekdayNo],
    weekend: weekdayNo === 0 ? "sun" : weekdayNo === 6 ? "sat" : null,
  };
}

function tokenJson(token: MemoToken): string {
  return JSON.stringify(token);
}

function readToken(event: React.DragEvent): MemoToken | null {
  const raw = event.dataTransfer.getData(MEMO_DRAG_TYPE);
  if (!raw) return null;
  try {
    const token = JSON.parse(raw) as MemoToken;
    if (token.kind === "placement" && typeof token.id === "string") return token;
    if (token.kind === "driver" && typeof token.driverId === "string" && typeof token.label === "string") return token;
    if (token.kind === "custom" && typeof token.label === "string") return token;
  } catch {
    // 他のドラッグデータは無視する。
  }
  return null;
}

function NameSlip({
  placement,
  color,
  selected,
  disabled,
  onSelect,
  onRemove,
}: {
  placement: ShiftMemoPlacement;
  color: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(MEMO_DRAG_TYPE, tokenJson({ kind: "placement", id: placement.id }));
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onSelect();
      }}
      className={cn(
        "group/slip inline-flex min-h-7 max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white py-1 pl-1.5 pr-1 text-[11px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition",
        !disabled && "cursor-grab active:cursor-grabbing hover:-translate-y-px hover:shadow-sm",
        selected && "ring-2 ring-indigo-400 ring-offset-1",
      )}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      title={disabled ? placement.label : `${placement.label}を選択`}
    >
      <FontAwesomeIcon icon={faGripVertical} className="h-2.5 w-2.5 shrink-0 text-slate-300" />
      <span className="truncate">{placement.label}</span>
      {!disabled && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`${placement.label}を外す`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }
          }}
          className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-rose-500"
        >
          <FontAwesomeIcon icon={faXmark} className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

export default function ShiftMemoBoard({
  dates,
  courses,
  drivers,
  canWrite,
  today,
}: {
  dates: string[];
  courses: MemoCourse[];
  drivers: MemoDriver[];
  canWrite: boolean;
  today: string;
}) {
  const memoKey = dates.length
    ? `/api/admin/shifts/memo?start=${dates[0]}&end=${dates[dates.length - 1]}`
    : null;
  const memoApi = useApi<MemoResponse>(memoKey, {
    keepPreviousData: false,
    revalidateOnFocus: false,
  });
  const [daysByDate, setDaysByDate] = useState<Record<string, ShiftMemoDay>>({});
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<MemoToken | null>(null);
  const [driverSearch, setDriverSearch] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  // 同じ日の連続D&Dを並列送信すると、遅れて完了した古いPUTが新しい配置を戻してしまう。
  // 日付ごとの最新版だけをキューに残し、必ず直列で保存する。
  const pendingSavesRef = useRef<Map<string, ShiftMemoDay>>(new Map());
  const saveLoopRunningRef = useRef(false);

  const lanes = useMemo<MemoLane[]>(() => {
    return courses.flatMap((course) => {
      const baseLabel = course.summary_title?.trim() || course.name;
      if (course.uses_cycles) {
        const cycles = (course.course_cycles ?? []).filter((cycle) => cycle.active !== false);
        if (cycles.length > 0) {
          return cycles.map((cycle) => ({
            key: laneKey(course.id, cycle.cycle_no),
            courseId: course.id,
            cycleNo: cycle.cycle_no,
            label: `${baseLabel} ${cycle.label?.trim() || `C${cycle.cycle_no}`}`,
            color: course.color || "#94a3b8",
          }));
        }
      }
      return [{
        key: laneKey(course.id, 0),
        courseId: course.id,
        cycleNo: 0,
        label: baseLabel,
        color: course.color || "#94a3b8",
      }];
    });
  }, [courses]);
  const laneByKey = useMemo(() => new Map(lanes.map((lane) => [lane.key, lane])), [lanes]);

  useEffect(() => {
    if (!memoKey || !memoApi.data || loadedKeyRef.current === memoKey) return;
    const next: Record<string, ShiftMemoDay> = {};
    for (const date of dates) next[date] = { date, placements: [], note: "" };
    for (const day of memoApi.data.days ?? []) next[day.date] = day;
    setDaysByDate(next);
    loadedKeyRef.current = memoKey;
    setExpandedDate(null);
    setSelectedToken(null);
    setSaveError(null);
  }, [dates, memoApi.data, memoKey]);

  useEffect(() => {
    if (saving === 0) return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [saving]);

  const visibleDrivers = useMemo(() => {
    const query = driverSearch.trim().toLocaleLowerCase("ja-JP");
    if (!query) return drivers;
    return drivers.filter((driver) => getDisplayName(driver).toLocaleLowerCase("ja-JP").includes(query));
  }, [driverSearch, drivers]);

  const findPlacement = (id: string): { date: string; placement: ShiftMemoPlacement } | null => {
    for (const day of Object.values(daysByDate)) {
      const placement = day.placements.find((item) => item.id === id);
      if (placement) return { date: day.date, placement };
    }
    return null;
  };

  const persistDates = (next: Record<string, ShiftMemoDay>, changedDates: string[]) => {
    const uniqueDates = [...new Set(changedDates)];
    if (!canWrite || uniqueDates.length === 0 || memoApi.data?.unavailable) return;
    for (const date of uniqueDates) {
      pendingSavesRef.current.set(date, next[date] ?? { date, placements: [], note: "" });
    }
    if (saveLoopRunningRef.current) return;
    saveLoopRunningRef.current = true;
    setSaving(1);
    setSaveError(null);
    void (async () => {
      try {
        while (pendingSavesRef.current.size > 0) {
          const batch = [...pendingSavesRef.current.values()];
          pendingSavesRef.current.clear();
          try {
            await apiFetch("/api/admin/shifts/memo", {
              method: "PUT",
              body: JSON.stringify({ days: batch }),
            });
          } catch (error) {
            // 通信中に同じ日がさらに編集されていれば、キュー側の新しい値を優先する。
            for (const day of batch) {
              if (!pendingSavesRef.current.has(day.date)) pendingSavesRef.current.set(day.date, day);
            }
            setSaveError(error instanceof Error ? error.message : "シフトメモを保存できませんでした");
            break;
          }
        }
      } finally {
        saveLoopRunningRef.current = false;
        setSaving(0);
      }
    })();
  };

  const commit = (next: Record<string, ShiftMemoDay>, changedDates: string[]) => {
    setDaysByDate(next);
    persistDates(next, changedDates);
  };

  const placeToken = (token: MemoToken, date: string, lane?: MemoLane) => {
    if (!canWrite) return;
    const next = { ...daysByDate };
    const targetDay = next[date] ?? { date, placements: [], note: "" };
    const changedDates = [date];
    let placement: ShiftMemoPlacement;

    if (token.kind === "placement") {
      const found = findPlacement(token.id);
      if (!found) return;
      const sourceDay = next[found.date] ?? { date: found.date, placements: [], note: "" };
      next[found.date] = {
        ...sourceDay,
        placements: sourceDay.placements.filter((item) => item.id !== token.id),
      };
      changedDates.push(found.date);
      placement = {
        ...found.placement,
        courseId: lane?.courseId ?? found.placement.courseId,
        cycleNo: lane?.cycleNo ?? found.placement.cycleNo,
      };
    } else {
      if (!lane) {
        setSelectedToken(token);
        setExpandedDate(date);
        return;
      }
      placement = {
        id: createPlacementId(),
        courseId: lane.courseId,
        cycleNo: lane.cycleNo,
        driverId: token.kind === "driver" ? token.driverId : null,
        label: token.label.trim(),
      };
    }

    // 同じ日内の移動では、この時点の next[date] は旧レーンから札を外した後の状態。
    // 最初に取得した targetDay を使うと同じIDが複製されるため、必ず最新版へ追加する。
    const destinationDay = next[date] ?? targetDay;
    next[date] = { ...destinationDay, placements: [...destinationDay.placements, placement] };
    setSelectedToken(null);
    commit(next, changedDates);
  };

  const removePlacement = (date: string, id: string) => {
    if (!canWrite) return;
    const day = daysByDate[date] ?? { date, placements: [], note: "" };
    const next = {
      ...daysByDate,
      [date]: { ...day, placements: day.placements.filter((item) => item.id !== id) },
    };
    if (selectedToken?.kind === "placement" && selectedToken.id === id) setSelectedToken(null);
    commit(next, [date]);
  };

  const updateNote = (date: string, note: string) => {
    setDaysByDate((current) => {
      const day = current[date] ?? { date, placements: [], note: "" };
      return { ...current, [date]: { ...day, note } };
    });
  };

  const saveNote = (date: string) => {
    const day = daysByDate[date] ?? { date, placements: [], note: "" };
    persistDates(daysByDate, [day.date]);
  };

  const startTokenDrag = (event: React.DragEvent, token: MemoToken) => {
    event.dataTransfer.effectAllowed = token.kind === "placement" ? "move" : "copy";
    event.dataTransfer.setData(MEMO_DRAG_TYPE, tokenJson(token));
  };

  const dropOnDate = (event: React.DragEvent, date: string) => {
    event.preventDefault();
    const token = readToken(event);
    if (!token) return;
    placeToken(token, date);
  };

  const dropOnLane = (event: React.DragEvent, date: string, lane: MemoLane) => {
    event.preventDefault();
    event.stopPropagation();
    const token = readToken(event);
    if (token) placeToken(token, date, lane);
  };

  const selectCustomLabel = () => {
    const label = customLabel.trim().slice(0, 40);
    if (!label) return;
    setSelectedToken({ kind: "custom", label });
    setCustomLabel("");
  };

  const tokenLabel = (() => {
    if (!selectedToken) return null;
    if (selectedToken.kind === "placement") return findPlacement(selectedToken.id)?.placement.label ?? null;
    return selectedToken.label;
  })();

  const renderDriverTray = (compact = false) => (
    <div className={cn("rounded-xl border border-slate-200 bg-white", compact ? "p-3" : "p-3 md:p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <FontAwesomeIcon icon={faArrowPointer} className="h-3.5 w-3.5 text-slate-400" />
          名前札
        </div>
        <div className="flex h-8 min-w-44 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 focus-within:border-slate-400">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="h-3 w-3 text-slate-400" />
          <input
            value={driverSearch}
            onChange={(event) => setDriverSearch(event.target.value)}
            placeholder="名前を検索"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </div>
        {canWrite && (
          <div className="flex h-8 min-w-52 flex-1 items-center rounded-lg border border-dashed border-slate-300 bg-white pl-2.5">
            <input
              value={customLabel}
              maxLength={40}
              onChange={(event) => setCustomLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) selectCustomLabel();
              }}
              placeholder="応援1名・未定など"
              className="min-w-0 flex-1 text-xs outline-none"
            />
            <button
              type="button"
              onClick={selectCustomLabel}
              disabled={!customLabel.trim()}
              className="inline-flex h-full items-center gap-1 rounded-r-lg px-2.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
              文字札
            </button>
          </div>
        )}
      </div>
      <div className={cn("mt-3 flex flex-wrap gap-1.5 overflow-y-auto", compact ? "max-h-24" : "max-h-28")}>
        {visibleDrivers.map((driver) => {
          const label = getDisplayName(driver);
          const token: MemoToken = { kind: "driver", driverId: driver.id, label };
          const active = selectedToken?.kind === "driver" && selectedToken.driverId === driver.id;
          return (
            <button
              key={driver.id}
              type="button"
              draggable={canWrite}
              onDragStart={(event) => startTokenDrag(event, token)}
              onClick={() => canWrite && setSelectedToken(active ? null : token)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2 text-xs font-medium shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
                canWrite && "cursor-grab active:cursor-grabbing",
                active ? "border-indigo-400 text-indigo-700 ring-2 ring-indigo-100" : "border-slate-200 text-slate-700 hover:border-slate-300",
              )}
            >
              <FontAwesomeIcon icon={faGripVertical} className="h-3 w-3 text-slate-300" />
              {label}
            </button>
          );
        })}
        {visibleDrivers.length === 0 && <span className="py-1 text-xs text-slate-400">該当する名前がありません</span>}
      </div>
      {tokenLabel && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <span><b>{tokenLabel}</b> を選択中。置きたい日またはコースを押してください。</span>
          <button type="button" onClick={() => setSelectedToken(null)} className="shrink-0 font-medium hover:underline">選択解除</button>
        </div>
      )}
    </div>
  );

  if (memoApi.isInitialLoading || loadedKeyRef.current !== memoKey) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {dates.map((date) => <Skeleton key={date} className="h-44 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (memoApi.data?.unavailable) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-amber-900">シフトメモは準備中です</p>
        <p className="mt-1 text-xs text-amber-700">migration 149 の適用後に利用できます。正式シフトには影響ありません。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-slate-500">
          正式シフトとは別の共有メモです。名前札を日付へ運び、日付を開いてコースへ置きます。
        </p>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className={cn("h-2 w-2 rounded-full", saving > 0 ? "animate-pulse bg-amber-400" : "bg-emerald-500")} />
          {saving > 0 ? "メモを保存中…" : "メモは自動保存されます"}
        </span>
      </div>
      {saveError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveError}</div>}

      {renderDriverTray()}

      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {dates.map((date) => {
          const day = daysByDate[date] ?? { date, placements: [], note: "" };
          const dateInfo = formatMemoDate(date);
          const groups = new Map<string, ShiftMemoPlacement[]>();
          for (const placement of day.placements) {
            const key = laneKey(placement.courseId, placement.cycleNo);
            groups.set(key, [...(groups.get(key) ?? []), placement]);
          }
          return (
            <article
              key={date}
              onDragOver={(event) => {
                if (canWrite) event.preventDefault();
              }}
              onDrop={(event) => dropOnDate(event, date)}
              onClick={() => setExpandedDate(date)}
              className={cn(
                "group/day min-h-40 rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition",
                canWrite && "hover:border-slate-300 hover:shadow-sm",
                date === today ? "border-amber-300 ring-1 ring-amber-100" : "border-slate-200",
                expandedDate === date && "border-indigo-400 ring-2 ring-indigo-100",
              )}
            >
              <header className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-1.5">
                  <span className={cn(
                    "text-lg font-bold tabular-nums",
                    dateInfo.weekend === "sun" ? "text-rose-600" : dateInfo.weekend === "sat" ? "text-blue-600" : "text-slate-900",
                  )}>
                    {dateInfo.day}日
                  </span>
                  <span className="text-[11px] text-slate-400">（{dateInfo.weekday}）</span>
                  {date === today && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">今日</span>}
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedDate(date);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={`${dateInfo.day}日を大きく開く`}
                >
                  <FontAwesomeIcon icon={faExpand} className="h-3.5 w-3.5" />
                </button>
              </header>

              {day.placements.length === 0 ? (
                <div className="flex min-h-20 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 px-3 text-center text-[11px] text-slate-400">
                  <FontAwesomeIcon icon={faNoteSticky} className="mb-1.5 h-4 w-4 text-slate-300" />
                  開いて名前を置く
                </div>
              ) : (
                <div className="space-y-2.5">
                  {[...groups.entries()].map(([key, placements]) => {
                    const lane = laneByKey.get(key);
                    const color = lane?.color ?? "#94a3b8";
                    return (
                      <section key={key}>
                        <p className="mb-1 truncate text-[10px] font-semibold text-slate-400">{lane?.label ?? "過去のコース"}</p>
                        <div className="flex flex-wrap gap-1">
                          {placements.map((placement) => (
                            <NameSlip
                              key={placement.id}
                              placement={placement}
                              color={color}
                              selected={selectedToken?.kind === "placement" && selectedToken.id === placement.id}
                              disabled={!canWrite}
                              onSelect={() => setSelectedToken({ kind: "placement", id: placement.id })}
                              onRemove={() => removePlacement(date, placement.id)}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
              {day.note.trim() && (
                <p className="mt-3 line-clamp-2 border-t border-dashed border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-500">
                  {day.note}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {expandedDate && (() => {
        const day = daysByDate[expandedDate] ?? { date: expandedDate, placements: [], note: "" };
        const dateInfo = formatMemoDate(expandedDate);
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-0 backdrop-blur-[1px] md:items-center md:p-5"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setExpandedDate(null);
            }}
          >
            <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-slate-50 shadow-2xl md:max-h-[90vh] md:rounded-2xl">
              <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{dateInfo.day}日（{dateInfo.weekday}）のメモ</h2>
                  <p className="text-[11px] text-slate-500">名前を選んでコースを押すか、札をドラッグしてください。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedDate(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="閉じる"
                >
                  <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
                </button>
              </header>
              <div className="overflow-y-auto p-3 md:p-5">
                {renderDriverTray(true)}
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {lanes.map((lane) => {
                    const placements = day.placements.filter(
                      (item) => item.courseId === lane.courseId && item.cycleNo === lane.cycleNo,
                    );
                    return (
                      <section
                        key={lane.key}
                        onDragOver={(event) => canWrite && event.preventDefault()}
                        onDrop={(event) => dropOnLane(event, expandedDate, lane)}
                        onClick={() => selectedToken && placeToken(selectedToken, expandedDate, lane)}
                        className={cn(
                          "min-h-28 rounded-xl border border-slate-200 bg-white p-3 transition",
                          canWrite && "cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/20",
                          selectedToken && "border-dashed border-indigo-300",
                        )}
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <span className="h-5 w-1 rounded-full" style={{ backgroundColor: lane.color }} />
                          <h3 className="text-sm font-semibold text-slate-800">{lane.label}</h3>
                          <span className="ml-auto text-[10px] text-slate-400">{placements.length}枚</span>
                        </div>
                        <div className="flex min-h-12 flex-wrap content-start gap-1.5 rounded-lg border border-dashed border-slate-200 p-2">
                          {placements.map((placement) => (
                            <NameSlip
                              key={placement.id}
                              placement={placement}
                              color={lane.color}
                              selected={selectedToken?.kind === "placement" && selectedToken.id === placement.id}
                              disabled={!canWrite}
                              onSelect={() => setSelectedToken({ kind: "placement", id: placement.id })}
                              onRemove={() => removePlacement(expandedDate, placement.id)}
                            />
                          ))}
                          {placements.length === 0 && (
                            <span className="m-auto text-[11px] text-slate-300">ここに名前を置く</span>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">この日の自由メモ</label>
                  <textarea
                    value={day.note}
                    disabled={!canWrite}
                    maxLength={2000}
                    rows={3}
                    onChange={(event) => updateNote(expandedDate, event.target.value)}
                    onBlur={() => saveNote(expandedDate)}
                    placeholder="午前だけ、応援を確認、連絡待ちなど"
                    className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-slate-400 disabled:bg-slate-50"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
