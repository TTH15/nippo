"use client";

import Link from "next/link";
import { useMemo, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faEllipsis,
  faEye,
  faEyeSlash,
  faGripLines,
  faLock,
  faMagnifyingGlass,
  faPlus,
  faRotateLeft,
  faTriangleExclamation,
  faTruck,
} from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/ui/utils";
import { findDuplicateCourseIds } from "./previewLogic";

type Course = { id: string; name: string; carrier: string; routeId: string; color: string };
type RouteGroup = { id: string; name: string; carrier: string; color: string };
type PersonToken = { name: string; sourceKey?: string };

const DAYS = Array.from({ length: 15 }, (_, index) => index + 1);
const WEEKDAYS = ["土", "日", "月", "火", "水", "木", "金", "土", "日", "月", "火", "水", "木", "金", "土"];
const PEOPLE = ["日笠", "坂田", "廣瀬", "猪上", "木下", "梶原", "勝政", "平石", "島本", "杉本", "池畑", "木村", "吉田", "磯江", "辻村", "桑野", "川人", "山本", "西脇", "平中"];
const ROUTE_GROUPS: RouteGroup[] = [
  { id: "yamato-yokooji", name: "横大路", carrier: "ヤマト運輸", color: "#3b82f6" },
  { id: "yamato-mibu", name: "壬生", carrier: "ヤマト運輸", color: "#ef4444" },
  { id: "yamato-ujitawara", name: "宇治田原", carrier: "ヤマト運輸", color: "#22c55e" },
  { id: "yamato-mid", name: "ミッド", carrier: "ヤマト運輸", color: "#8b5cf6" },
  { id: "amazon-kamitoba", name: "上鳥羽吉祥院", carrier: "Amazon", color: "#f59e0b" },
  { id: "other-spot", name: "スポット便", carrier: "その他", color: "#f97316" },
];
const INITIAL_COURSES: Course[] = [
  { id: "yokooji-hazukashi", name: "羽束師菱川町", carrier: "ヤマト運輸", routeId: "yamato-yokooji", color: "#3b82f6" },
  { id: "yokooji-koga", name: "久我西出町", carrier: "ヤマト運輸", routeId: "yamato-yokooji", color: "#06b6d4" },
  { id: "yokooji-shimosu", name: "横大路下三栖", carrier: "ヤマト運輸", routeId: "yamato-yokooji", color: "#6366f1" },
  { id: "mibu-matsubara", name: "壬生松原町", carrier: "ヤマト運輸", routeId: "yamato-mibu", color: "#ef4444" },
  { id: "mibu-bojo", name: "壬生坊城町", carrier: "ヤマト運輸", routeId: "yamato-mibu", color: "#f97316" },
  { id: "ujitawara-gonokuchi", name: "郷之口", carrier: "ヤマト運輸", routeId: "yamato-ujitawara", color: "#22c55e" },
  { id: "ujitawara-tachikawa", name: "立川", carrier: "ヤマト運輸", routeId: "yamato-ujitawara", color: "#84cc16" },
  { id: "mid-area-a", name: "ミッド Aエリア", carrier: "ヤマト運輸", routeId: "yamato-mid", color: "#8b5cf6" },
  { id: "mid-area-b", name: "ミッド Bエリア", carrier: "ヤマト運輸", routeId: "yamato-mid", color: "#a855f7" },
  { id: "amazon-nishikujo", name: "西九条エリア", carrier: "Amazon", routeId: "amazon-kamitoba", color: "#f59e0b" },
  { id: "amazon-kisshoin", name: "吉祥院エリア", carrier: "Amazon", routeId: "amazon-kamitoba", color: "#ec4899" },
  { id: "spot-free", name: "フリー枠", carrier: "その他", routeId: "other-spot", color: "#f97316" },
];

const PERSON_COLORS = ["#06b6d4", "#8b5cf6", "#f97316", "#22c55e", "#3b82f6", "#ec4899"];
const PERSON_DRAG_TYPE = "application/x-hakotora-preview-person";
const COURSE_DRAG_TYPE = "application/x-hakotora-preview-course";

function cellKey(courseId: string, day: number): string {
  return `${courseId}:${day}`;
}

function colorForPerson(name: string): string {
  let sum = 0;
  for (const char of name) sum += char.charCodeAt(0);
  return PERSON_COLORS[sum % PERSON_COLORS.length];
}

function createMockAssignments(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  INITIAL_COURSES.forEach((course, courseIndex) => {
    DAYS.forEach((day) => {
      if ((day + courseIndex * 2) % 4 === 0) return;
      result[cellKey(course.id, day)] = [PEOPLE[(day * 3 + courseIndex * 2) % PEOPLE.length]];
      if ((day + courseIndex) % 5 === 0) {
        result[cellKey(course.id, day)].push(PEOPLE[(day + courseIndex * 5 + 7) % PEOPLE.length]);
      }
    });
  });
  return result;
}

function PersonSlip({ name, sourceKey }: { name: string; sourceKey?: string }) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        const token: PersonToken = { name, sourceKey };
        event.dataTransfer.effectAllowed = sourceKey ? "move" : "copy";
        event.dataTransfer.setData(PERSON_DRAG_TYPE, JSON.stringify(token));
      }}
      className="inline-flex h-7 max-w-full cursor-grab items-center overflow-hidden rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)] active:cursor-grabbing"
      style={{ borderLeftColor: colorForPerson(name), borderLeftWidth: 3 }}
    >
      <span className="min-w-0 truncate px-2">{name}</span>
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
  const [courseMenuId, setCourseMenuId] = useState<string | null>(null);
  const [addingRouteId, setAddingRouteId] = useState<string | null>(null);
  const [newCourseName, setNewCourseName] = useState("");
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editingCourseName, setEditingCourseName] = useState("");
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    token: PersonToken;
    targetKey: string;
    existingCourseNames: string[];
  } | null>(null);
  const [search, setSearch] = useState("");
  const [customName, setCustomName] = useState("");
  const [extraPeople, setExtraPeople] = useState<string[]>([]);
  const [note, setNote] = useState("鈴木さんは午前だけ。応援1名は昼までに確定予定。\nミッド社員の配置は前日に再確認する。");

  const orderedCourses = useMemo(() => {
    const byId = new Map(courses.map((course) => [course.id, course]));
    return courseOrder.map((id) => byId.get(id)).filter((course): course is Course => !!course);
  }, [courseOrder, courses]);
  const visibleCourses = orderedCourses.filter((course) => !hiddenCourseIds.includes(course.id));
  const hiddenCourses = orderedCourses.filter((course) => hiddenCourseIds.includes(course.id));
  const filteredPeople = [...PEOPLE, ...extraPeople].filter((name) => name.includes(search.trim()));
  const boardWidth = courseWidth + dayWidth * DAYS.length;

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
  };

  const dropPerson = (event: DragEvent, targetKey: string) => {
    const raw = event.dataTransfer.getData(PERSON_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    const token = JSON.parse(raw) as PersonToken;
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
      return;
    }

    applyPersonDrop(token, targetKey);
  };

  const returnPersonToRack = (event: DragEvent) => {
    const raw = event.dataTransfer.getData(PERSON_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    const token = JSON.parse(raw) as PersonToken;
    if (!token.sourceKey) return;
    setAssignments((current) => {
      const source = [...(current[token.sourceKey!] ?? [])];
      const sourceIndex = source.indexOf(token.name);
      if (sourceIndex >= 0) source.splice(sourceIndex, 1);
      return { ...current, [token.sourceKey!]: source };
    });
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
    setCourses((current) => [...current, { id, name, carrier: route.carrier, routeId: route.id, color: route.color }]);
    setCourseOrder((current) => [...current, id]);
    setNewCourseName("");
    setAddingRouteId(null);
  };

  const saveCourseName = (courseId: string) => {
    const name = editingCourseName.trim().slice(0, 30);
    if (name) {
      setCourses((current) => current.map((course) => course.id === courseId ? { ...course, name } : course));
    }
    setEditingCourseId(null);
    setEditingCourseName("");
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

  const selectedAssignments = visibleCourses.map((course) => ({
    course,
    people: assignments[cellKey(course.id, selectedDay)] ?? [],
  }));

  return (
    <main className="h-dvh overflow-hidden bg-slate-100 p-3 text-slate-900 md:p-5">
      <div className="mx-auto flex h-[calc(100dvh-1.5rem)] min-h-0 max-w-[1900px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-300/30 md:h-[calc(100dvh-2.5rem)]">
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
            <p className="text-[10px] text-slate-400">この端末だけに保存する想定・実際の保存なし</p>
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
          <section className="min-h-0 min-w-0 overflow-auto bg-white">
            <div className="relative grid min-h-full content-start" style={{ gridTemplateColumns: `${courseWidth}px repeat(${DAYS.length}, ${dayWidth}px)`, width: boardWidth }}>
              <div className="sticky left-0 top-0 z-50 flex h-16 items-center border-b border-r border-slate-200 bg-slate-50 px-3">
                <span className="text-xs font-bold text-slate-600">町名・担当枠</span>
                <button
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
                return (
                  <div key={day} className={cn("sticky top-0 z-40 h-16 border-b border-r border-slate-200 bg-slate-50 text-xs font-bold transition", selectedDay === day && "bg-indigo-50 text-indigo-700 ring-2 ring-inset ring-indigo-500", selectedDay !== day && weekend === "sat" && "text-blue-600", selectedDay !== day && weekend === "sun" && "text-rose-600")}>
                    <button type="button" onClick={() => setSelectedDay(day)} className="flex h-full w-full flex-col items-center justify-center">
                      <span className="text-sm">{day}日</span><span className="mt-0.5 text-[10px]">（{WEEKDAYS[index]}）</span>
                    </button>
                    <button
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
                className="pointer-events-none absolute bottom-0 top-16 z-[35] border-x-2 border-indigo-500"
                style={{ left: courseWidth + (selectedDay - 1) * dayWidth, width: dayWidth }}
              />

              {ROUTE_GROUPS.map((route) => (
                <div key={route.id} className="contents">
                  <div className="sticky left-0 z-30 flex h-11 items-center gap-2 border-b border-r border-slate-200 bg-slate-100 px-3">
                    <FontAwesomeIcon icon={faTruck} className="h-3 w-3 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-[9px] font-medium text-slate-400">{route.carrier}</div>
                      <div className="truncate text-[11px] font-bold text-slate-700">{route.name}</div>
                    </div>
                    <button type="button" onClick={() => { setAddingRouteId((id) => id === route.id ? null : route.id); setNewCourseName(""); }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`${route.name}に町名・担当枠を追加`} title="町名・担当枠を追加"><FontAwesomeIcon icon={faPlus} className="h-3 w-3" /></button>
                    {addingRouteId === route.id && (
                      <div className="absolute left-2 top-10 z-50 w-64 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl">
                        <label className="mb-1.5 block text-[10px] font-bold text-slate-600">{route.name}に担当枠を追加</label>
                        <div className="flex h-8 overflow-hidden rounded-lg border border-slate-200 focus-within:border-indigo-400">
                          <input autoFocus value={newCourseName} onChange={(event) => setNewCourseName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addCourse(route); if (event.key === "Escape") setAddingRouteId(null); }} placeholder="町名・エリア名・作業名" className="min-w-0 flex-1 px-2 text-[11px] outline-none" />
                          <button type="button" onClick={() => addCourse(route)} className="border-l border-slate-200 bg-slate-800 px-3 text-[10px] font-semibold text-white hover:bg-slate-700">追加</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex h-11 items-center border-b border-slate-200 bg-slate-100/80 px-3 text-[9px] text-slate-400" style={{ gridColumn: `span ${DAYS.length}` }}>
                    町名・エリア・応援枠などを自由に追加できます
                  </div>

                  {visibleCourses.filter((course) => course.routeId === route.id).map((course) => (
                    <div key={course.id} className="contents">
                      <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const sourceId = event.dataTransfer.getData(COURSE_DRAG_TYPE); if (sourceId) reorderCourse(sourceId, course.id); }} className="group/course sticky left-0 z-30 flex min-h-28 items-center gap-2 border-b border-r border-slate-200 bg-white px-2.5">
                        <button type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(COURSE_DRAG_TYPE, course.id); }} className="inline-flex h-7 w-6 cursor-grab items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing" aria-label={`${course.name}を並べ替える`}><FontAwesomeIcon icon={faGripLines} className="h-3.5 w-3.5" /></button>
                        <span className="h-12 w-1 shrink-0 rounded-full" style={{ backgroundColor: course.color }} />
                        {editingCourseId === course.id ? (
                          <input autoFocus value={editingCourseName} onChange={(event) => setEditingCourseName(event.target.value)} onBlur={() => saveCourseName(course.id)} onKeyDown={(event) => { if (event.key === "Enter") saveCourseName(course.id); if (event.key === "Escape") { setEditingCourseId(null); setEditingCourseName(""); } }} className="min-w-0 flex-1 rounded-md border border-indigo-300 px-2 py-1 text-xs font-bold text-slate-700 outline-none" aria-label={`${course.name}の名前`} />
                        ) : (
                          <span className="min-w-0 flex-1 text-xs font-bold leading-snug text-slate-700" title={course.name}>{course.name}</span>
                        )}
                        <button type="button" onClick={() => setCourseMenuId((id) => id === course.id ? null : course.id)} className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/95 text-slate-400 opacity-0 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-700 focus:opacity-100 group-hover/course:opacity-100" aria-label={`${course.name}の操作`}><FontAwesomeIcon icon={faEllipsis} className="h-3 w-3" /></button>
                        {courseMenuId === course.id && (
                          <div className="absolute right-1.5 top-9 z-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                            <button type="button" onClick={() => { setEditingCourseId(course.id); setEditingCourseName(course.name); setCourseMenuId(null); }} className="flex h-8 w-full items-center whitespace-nowrap rounded-md px-2.5 text-left text-[10px] font-medium text-slate-600 hover:bg-slate-100">名前を変更</button>
                            <button type="button" onClick={() => { setHiddenCourseIds((ids) => [...ids, course.id]); setCourseMenuId(null); }} className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"><FontAwesomeIcon icon={faEyeSlash} className="h-3 w-3 text-slate-400" />この担当枠を非表示</button>
                          </div>
                        )}
                      </div>
                      {DAYS.map((day) => {
                        const key = cellKey(course.id, day);
                        const people = assignments[key] ?? [];
                        return (
                          <div key={key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropPerson(event, key)} onClick={() => setSelectedDay(day)} className={cn("flex min-h-28 cursor-pointer flex-col content-start items-start gap-1.5 border-b border-r border-slate-200 p-1.5 transition hover:bg-slate-50", selectedDay === day && "bg-indigo-50/45")}>
                            {people.map((name, personIndex) => <PersonSlip key={`${name}-${personIndex}`} name={name} sourceKey={key} />)}
                            {people.length === 0 && <span className="m-auto text-base font-light text-slate-300">＋</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
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

          <aside className="min-h-0 overflow-y-auto border-l border-slate-200 bg-slate-50/70">
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
              <h2 className="text-lg font-black text-slate-900">8月{selectedDay}日（{WEEKDAYS[selectedDay - 1]}）</h2>
              <p className="mt-0.5 text-[10px] text-slate-500">札全体をドラッグして、左のセルまたは下の担当枠へ置きます。</p>
            </div>
            <div className="space-y-4 p-3.5">
              <section onDragOver={(event) => event.preventDefault()} onDrop={returnPersonToRack} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">名前札</span>
                  <span className="text-[9px] text-slate-400">配置済みの札をここへ戻すと解除</span>
                </div>
                <div className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5"><FontAwesomeIcon icon={faMagnifyingGlass} className="h-3 w-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名前を検索" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>
                <div className="flex min-h-11 max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-1.5">{filteredPeople.map((name) => <PersonSlip key={name} name={name} />)}</div>
                <div className="mt-2 flex h-8 items-center rounded-lg border border-dashed border-slate-300 pl-2.5">
                  <input value={customName} onChange={(event) => setCustomName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCustomName()} placeholder="応援1名・未定など" className="min-w-0 flex-1 text-xs outline-none" />
                  <button type="button" onClick={addCustomName} className="inline-flex h-full items-center gap-1 px-2 text-[10px] font-medium text-slate-600 hover:bg-slate-50"><FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" />文字札</button>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-600">この日の配置</h3><span className="text-[10px] text-slate-400">{selectedAssignments.reduce((sum, entry) => sum + entry.people.length, 0)}枚</span></div>
                {selectedAssignments.map(({ course, people }) => {
                  const key = cellKey(course.id, selectedDay);
                  return (
                    <div key={course.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropPerson(event, key)} className="rounded-lg border border-slate-200 bg-white p-2.5">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-4 w-1 rounded-full" style={{ backgroundColor: course.color }} />
                        <div className="min-w-0"><div className="truncate text-[9px] text-slate-400">{ROUTE_GROUPS.find((route) => route.id === course.routeId)?.name}</div><h4 className="truncate text-[11px] font-bold text-slate-700">{course.name}</h4></div>
                      </div>
                      <div className="flex min-h-8 flex-wrap gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-1.5">
                        {people.map((name, index) => <PersonSlip key={`${name}-${index}`} name={name} sourceKey={key} />)}
                        {people.length === 0 && <span className="m-auto text-[10px] text-slate-300">ここに名前を置く</span>}
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
        </div>
      </div>

      {pendingDuplicate && (() => {
        const targetCourseId = pendingDuplicate.targetKey.split(":")[0];
        const targetDay = Number(pendingDuplicate.targetKey.split(":").at(-1));
        const targetCourseName = courses.find((course) => course.id === targetCourseId)?.name ?? "選択した担当枠";
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={() => setPendingDuplicate(null)}>
            <section role="alertdialog" aria-modal="true" aria-labelledby="duplicate-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><FontAwesomeIcon icon={faTriangleExclamation} className="h-4 w-4" /></span>
                <div>
                  <h2 id="duplicate-title" className="text-sm font-black text-slate-900">同じ日に配置済みです</h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    {pendingDuplicate.token.name}さんは8月{targetDay}日に「{pendingDuplicate.existingCourseNames.join("」「")}」へ置かれています。「{targetCourseName}」にも置きますか？
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setPendingDuplicate(null)} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">キャンセル</button>
                <button type="button" onClick={() => { applyPersonDrop(pendingDuplicate.token, pendingDuplicate.targetKey); setPendingDuplicate(null); }} className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-700">それでも配置</button>
              </div>
            </section>
          </div>
        );
      })()}
    </main>
  );
}
