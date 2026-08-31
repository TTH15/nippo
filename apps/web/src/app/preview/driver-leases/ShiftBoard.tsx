"use client";
import { Fragment, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faChevronLeft, faChevronRight, faArrowRightArrowLeft, faRotateRight, faGear, faFileExport } from "@fortawesome/free-solid-svg-icons";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { DatePicker } from "@/lib/components/DatePicker";
import { ShiftDisplayPanel } from "@/lib/components/ShiftDisplayPanel";
import { cn } from "@/lib/ui/utils";
import { isJapanPublicHolidayYmd } from "@/lib/japanHolidays";
import { DATES, MODE_NAMES, activeLoan, filterDrivers, courseIdsFor, loanOwner, shiftFor, vehicleFor, type Driver, type LeaseMode } from "./model";
import { DemoPlate, Empty, Labels, LeaseBadge, type PageProps } from "./ui";
import { ShiftFilters } from "./ShiftFilters";
import { ShiftEditor } from "./ShiftEditor";
import { CourseAssignments } from "./CourseAssignments";
import { SelectionToggle } from "./SelectionToggle";
import { ShiftExportDialog } from "./ShiftExportDialog";
import { DayFilterTabs } from "./DayFilterTabs";
import { countDayDrivers, filterDayDrivers } from "./dayFilter";
import { useMobileLayout } from "./useMobileLayout";

import { driverDetailsVisible, dateForView, moveViewByDay, viewAtDate, type ShiftView } from "./navigation";

// admin/(ops)/shifts/page.tsx の半月ツールバー・固定列・セルの表示を複製。
// 独自の週表示にせず、既存の表にラベルとリース表示だけを追加する。
const COL = "w-[7.25rem] min-w-[7.25rem] max-w-[7.25rem] box-border";
const SMALL_BUTTON = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
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


const COURSE_COLORS: Record<string, string> = { a: "#fbbf24", b: "#38bdf8", c: "#34d399" };
function dateLabel(date: string) {
  const d = new Date(date + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}（${"日月火水木金土"[d.getDay()]}）`;
}
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


function Toggle({ value, options, onChange, className }: { value: string; options: [string, string][]; onChange: (value: string) => void; className?: string }) {
  return <div className={cn("inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white", className)}>{options.map(([id, name], i) => <button key={id} aria-pressed={value === id} onClick={() => onChange(id)} className={cn("whitespace-nowrap px-3 py-1.5 text-xs font-semibold", i > 0 && "border-l border-slate-300", value === id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50")}>{name}</button>)}</div>;
}

export default function ShiftBoard({ demo, setDemo, notify, confirm, guard, setDirty, navigate, target, view, setView }: PageProps & { view: ShiftView; setView: Dispatch<SetStateAction<ShiftView>> }) {
  const isMobile = useMobileLayout();
  const bind = <K extends keyof ShiftView,>(key: K): [ShiftView[K], Dispatch<SetStateAction<ShiftView[K]>>] => [view[key], next => setView(previous => ({ ...previous, [key]: typeof next === "function" ? (next as (value: ShiftView[K]) => ShiftView[K])(previous[key]) : next }))];
  const { labelIds, mode, query, grouped, showShift, showVehicle, showMeetingTime } = view;
  const showDriverDetails = driverDetailsVisible(view);
  const compactRows = !showVehicle && !showDriverDetails;
  const [yearMonth, setYearMonth] = bind("yearMonth");
  const [half, setHalf] = bind("half");
  const [axis, setAxis] = bind("axis");
  const [, setDay] = bind("day");
  const [exportOpen, setExportOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<{ driverId: string; date: string; loanId?: string } | null>(() => target.driverId && target.date ? { driverId: target.driverId, date: target.date, loanId: target.loanId } : null);
  const [courseEditing, setCourseEditing] = useState<{ courseId: string; date: string } | null>(null);
  const editing = editingKey ? shiftFor(demo, editingKey.driverId, editingKey.date) : undefined;
  const prefix = `${yearMonth.year}-${String(yearMonth.month).padStart(2, "0")}`;
  const start = half === "first" ? 1 : 16;
  const last = half === "first" ? 15 : new Date(yearMonth.year, yearMonth.month, 0).getDate();
  const dates = Array.from({ length: last - start + 1 }, (_, i) => `${prefix}-${String(start + i).padStart(2, "0")}`);
  const mobileDate = dateForView(view);
  const drivers = filterDrivers(demo, labelIds, mode, query);
  const groups = grouped ? (["MONTHLY", "DAILY", "NONE"] as LeaseMode[]).map(key => ({ key, name: MODE_NAMES[key], drivers: drivers.filter(d => d.mode === key) })).filter(g => g.drivers.length) : [{ key: "all", name: "ドライバー", drivers }];
  const dayCounts = countDayDrivers(demo, drivers, mobileDate);
  const mobileGroups = groups.map(group => ({ ...group, drivers: filterDayDrivers(demo, group.drivers, mobileDate, view.dayFilter) })).filter(group => group.drivers.length);
  const working = (date: string) => drivers.filter(d => shiftFor(demo, d.id, date)?.status === "work").length;
  const step = (direction: number) => {
    if ((direction === 1 && half === "first") || (direction === -1 && half === "second")) setHalf(half === "first" ? "second" : "first");
    else {
      const month = new Date(yearMonth.year, yearMonth.month - 1 + direction, 1);
      setYearMonth({ year: month.getFullYear(), month: month.getMonth() + 1 });
      setHalf(direction === 1 ? "first" : "second");
    }
    setDay(0);
  };
  const existingFeature = () => notify("既存機能の配置確認用です。このプレビューではラベル・リース・配車の変更を試せます");
  const edit = (driver: Driver, date: string) => {
    const shift = shiftFor(demo, driver.id, date);
    if (!shift) { notify("この日のモックデータはありません。2026年9月を選んでください"); return; }
    setEditingKey({ driverId: driver.id, date });
  };
  const vehicleContent = (d: Driver, date: string) => {
    const vehicle = vehicleFor(demo, d.id, date);
    const loan = activeLoan(demo, d.id, date);
    return <>
      <span className="mt-0.5 flex w-full min-w-0 items-center justify-center">{d.mode === "NONE" ? <span className="py-0.5 text-[10px] font-semibold text-amber-600">持込車両</span> : vehicle ? <DemoPlate vehicle={vehicle} className="!max-w-none w-full min-w-0 pointer-events-none"/> : <span className="py-0.5 text-[10px] text-slate-400">車両なし</span>}</span>
      {loan && <span className="flex items-center justify-center gap-1 text-[10px] font-medium text-amber-800"><FontAwesomeIcon icon={faArrowRightArrowLeft}/>{loan.status === "returned" ? "一時借用・返却済み" : "一時借用"}</span>}
    </>;
  };
  const cell = (d: Driver, date: string) => {
    const shift = shiftFor(demo, d.id, date);
    const courses = demo.courses.filter(c => courseIdsFor(shift).includes(c.id));
    const lent = demo.loans.find(l => loanOwner(demo, l)?.id === d.id && l.date === date && l.status !== "cancelled");
    return <button aria-label={`${d.name} ${date} のシフトを編集`} onClick={() => edit(d, date)} className={cn("group flex w-full flex-col gap-1 rounded-lg px-1.5 text-left transition-colors hover:bg-white/70", compactRows ? "min-h-11 justify-center py-1" : "min-h-[3.25rem] py-1.5", shift?.status === "off" && "items-center justify-center hover:bg-amber-100")}>
      {shift?.status === "work" ? <>
        {showShift && courses.map(course => <span key={course.id} className="flex h-6 w-full min-w-0 items-center overflow-hidden rounded-[6px] px-1.5" style={courseCellSurface(COURSE_COLORS[course.id])}><span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight text-slate-900">{course.short}</span><span className="ml-1 shrink-0 text-[9px] text-slate-600">終日</span></span>)}
        {showMeetingTime && <span className="w-full text-center text-[9px] text-slate-500">集合 07:30</span>}
        {showVehicle && vehicleContent(d, date)}
        {showVehicle && lent && <span className="text-[10px] text-amber-800">{lent.status === "returned" ? "貸出・返却済み" : "車両を貸出"}</span>}
        {!showShift && !showVehicle && !showMeetingTime && <span className="flex min-h-9 items-center justify-center text-xs font-medium text-slate-600">稼働</span>}
      </> : shift?.status === "off" ? <><span className="text-[12px] font-semibold text-amber-900">希望休</span>{showVehicle && lent && <span className="text-[10px] text-amber-800">{lent.status === "returned" ? "貸出・返却済み" : "車両を貸出"}</span>}</> : <span className="flex flex-1 items-center justify-center text-base text-slate-300">{shift ? <FontAwesomeIcon icon={faPlus}/> : "—"}</span>}
    </button>;
  };
  const courseAssignment = (d: Driver, date: string) => <span key={d.id} className={cn("mb-1 flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs text-slate-700", compactRows ? "py-1" : "py-2")}>
    <span className="font-medium">{d.name}</span>
    {showDriverDetails && <span className="text-[10px] text-slate-500">{MODE_NAMES[d.mode]}</span>}
    {showShift && <span className="text-[10px] text-slate-500">終日</span>}
    {showMeetingTime && <span className="text-[9px] text-slate-500">集合 07:30</span>}
    {showVehicle && vehicleContent(d, date)}
  </span>;
  return <div className="max-w-full">
    <div className="md:sticky z-30 -mx-3 px-3 md:-mx-6 md:px-6 bg-slate-50 pt-2 -mt-1 md:border-b md:border-slate-200/80" style={{ top: "var(--admin-header-h, 0px)" }}>
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:flex">
        <h1 className="order-1 shrink-0 text-lg font-bold text-slate-900 md:order-none md:text-xl">シフト管理</h1>
        <div className="order-3 col-span-2 flex w-full overflow-hidden rounded-lg border border-slate-300 bg-white md:order-none md:col-span-1 md:w-auto"><button className="min-w-0 flex-1 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">シフト表</button><button onClick={existingFeature} className="min-w-0 flex-1 whitespace-nowrap border-l border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600">シフトメモ</button></div>
      </div>
      <ShiftDisplayPanel toolbar={trigger => <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="contents">
        <div role="group" aria-label="表示する期間" className="hidden shrink-0 items-center gap-2 md:flex">
          <button className={SMALL_BUTTON + " w-9 !px-0"} aria-label="前の半月" onClick={() => step(-1)}><FontAwesomeIcon icon={faChevronLeft}/></button>
          <div className="shrink-0 [&_button]:h-9 [&_button]:w-[154px] [&_button]:rounded-lg [&_button]:px-3 [&_button]:text-xs [&_button]:font-semibold"><MonthYearPicker value={yearMonth} onChange={value => { setYearMonth(value); setDay(0); }}/></div>
          <Toggle className="h-9" value={half} options={[["first", "前半（1〜15日）"], ["second", "後半（16日〜）"]]} onChange={value => { setHalf(value); setDay(0); }}/>
          <button className={SMALL_BUTTON + " w-9 !px-0"} aria-label="次の半月" onClick={() => step(1)}><FontAwesomeIcon icon={faChevronRight}/></button>
        </div>
        {trigger}
      </div><div className="flex items-center gap-2"><button className={SMALL_BUTTON} onClick={() => setExportOpen(true)} disabled={!DATES.includes(mobileDate)} title="選択中の日別配車を画像にする"><FontAwesomeIcon icon={faFileExport}/>画像保存</button><button className={SMALL_BUTTON} onClick={() => notify("プレビュー内の最新データを表示しています。外部への通信はありません")}><FontAwesomeIcon icon={faRotateRight}/>更新</button><button className={SMALL_BUTTON} onClick={existingFeature}><FontAwesomeIcon icon={faGear}/>設定</button></div></div>}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div role="group" aria-label="表示する項目" className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs font-medium text-slate-500">表示項目</span>
            {([["showShift", "シフト", "担当コース・時間帯を表示"], ["showVehicle", "車両", "配車・一時貸出を表示"], ["showMeetingTime", "集合時刻", "集合時刻を表示"]] as const).map(([key, label, title]) => <SelectionToggle key={key} selected={view[key]} title={title} onClick={() => setView(previous => ({ ...previous, [key]: !previous[key] }))}>{label}</SelectionToggle>)}
            <SelectionToggle selected={showDriverDetails} title="名前に添えるラベル・契約区分を表示" onClick={() => setView(previous => ({ ...previous, showDriverDetails: !driverDetailsVisible(previous) }))}>ラベル・契約</SelectionToggle>
          </div>
          <div role="group" aria-label="表示の軸" className="hidden items-center gap-2 md:flex"><span className="text-xs font-medium text-slate-500">並び</span><Toggle value={axis} options={[["driver", "ドライバー軸"], ["course", "コース軸"]]} onChange={setAxis}/></div>
        </div>
      </ShiftDisplayPanel>
    </div>
    <ShiftFilters demo={demo} view={view} update={patch => setView(previous => ({ ...previous, ...patch }))} count={drivers.length}/>
    {!dates.some(date => DATES.includes(date)) && <p className="mb-3 text-sm text-slate-500">この月のモックデータはありません。2026年9月を選んでください。</p>}
    <div className="md:hidden sticky z-30 -mx-3 space-y-2 border-b border-slate-200/80 bg-slate-50 px-3 pb-2 pt-1" style={{ top: "var(--admin-header-h, 0px)" }}><div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5"><button aria-label="前の日" className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 text-slate-600" onClick={() => setView(previous => moveViewByDay(previous, -1))}><FontAwesomeIcon icon={faChevronLeft}/></button><div className="min-w-0 text-center"><DatePicker ariaLabel="表示する日付" value={new Date(mobileDate + "T12:00:00")} displayFormat="yyyy/M/d（E）" className="h-9 w-full justify-center border-0 bg-transparent px-1 text-sm font-bold text-slate-900 shadow-none" onChange={date => { if (date) setView(previous => viewAtDate(previous, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`)); }}/><p className="text-[11px] text-slate-500">稼働 {dayCounts.working}人</p></div><button aria-label="次の日" className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 text-slate-600" onClick={() => setView(previous => moveViewByDay(previous, 1))}><FontAwesomeIcon icon={faChevronRight}/></button></div><DayFilterTabs value={view.dayFilter} counts={dayCounts} onChange={dayFilter => setView(previous => ({ ...previous, dayFilter }))}/></div>
    {!drivers.length ? <Empty>条件に合うドライバーはいません。ラベルや契約の条件を変更してください。</Empty> : <>
      <div className="hidden md:block bg-white rounded-lg border border-slate-200/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-auto max-h-[calc(100vh-280px)] table-scroll">
        <table className="w-full text-sm min-w-[720px] border-separate border-spacing-0"><thead><tr className="bg-slate-50/95"><th className="sticky left-0 top-0 z-30 min-w-[11rem] border-r border-b border-slate-200/95 bg-slate-50/95 px-3 py-2.5 text-left font-medium text-slate-600 align-bottom"><span className="block text-[10px] font-normal leading-none text-slate-400">上段＝稼働人数</span>{axis === "driver" ? "ドライバー" : "コース"}</th>{dates.map(date => <th key={date} className={cn(COL, "sticky top-0 z-20 border-l border-b border-slate-200/90 px-1 py-2 text-center font-medium align-top", shiftDayTone(date).header)}><span className="mb-1 block text-[11px] font-bold leading-none tabular-nums text-slate-700">稼働 {working(date)}</span><span className="line-clamp-2 leading-tight">{dateLabel(date)}</span></th>)}</tr></thead><tbody>
          {axis === "driver" ? groups.map(group => <Fragment key={group.key}>{grouped && <tr><th colSpan={dates.length + 1} className="border-b border-slate-200 bg-slate-100/80 py-1.5 text-left text-xs font-semibold text-slate-600"><span className="sticky left-3">{group.name}<span className="ml-2 font-normal text-slate-400">{group.drivers.length}人</span></span></th></tr>}{group.drivers.map(d => <tr key={d.id}><th scope="row" className={cn("sticky left-0 z-[25] border-r border-b-2 border-slate-300 bg-white px-3 text-left align-middle", compactRows ? "py-0" : "py-2")}><button aria-label={`${d.name}の契約設定を開く`} className="min-h-11 font-medium text-slate-800 hover:underline" onClick={() => navigate({ page: "drivers", driverId: d.id, date: mobileDate })}>{d.name}</button>{showDriverDetails && <div className="mt-1 flex flex-wrap items-center gap-1"><Labels demo={demo} ids={d.labels}/>{!grouped && <LeaseBadge mode={d.mode}/>}</div>}</th>{dates.map(date => <td key={date} className={cn(COL, "relative border-l border-b-2 border-slate-300 px-1", compactRows ? "py-0 align-middle" : "py-1 align-top", shiftFor(demo, d.id, date)?.status === "off" ? "bg-amber-50 align-middle" : shiftDayTone(date).body)}>{cell(d, date)}</td>)}</tr>)}</Fragment>) : demo.courses.map(course => <tr key={course.id}><th className="sticky left-0 z-[25] border-r border-b border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700">{course.name}</th>{dates.map(date => <td key={date} className={cn(COL, "border-l border-b border-slate-200 p-1 align-top")}><button aria-label={`${course.name} ${date} の割当を編集`} className="min-h-11 w-full rounded-md p-0.5 text-left hover:bg-slate-50" onClick={() => DATES.includes(date) ? setCourseEditing({ courseId: course.id, date }) : notify("この日のモックデータはありません。2026年9月を選んでください")}>{drivers.filter(d => courseIdsFor(shiftFor(demo, d.id, date)).includes(course.id)).map(d => courseAssignment(d, date))}<span className="flex min-h-9 items-center justify-center text-slate-400"><FontAwesomeIcon icon={faPlus}/></span></button></td>)}</tr>)}
          <tr className="bg-slate-50"><td className="sticky left-0 z-10 border-r border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">未割当</td>{dates.map(date => <td key={date} className={cn(COL, "border-l border-t border-slate-200 px-1 py-2 text-center text-[11px] text-slate-400")}>{drivers.filter(d => shiftFor(demo, d.id, date)?.status === "empty").length || "—"}</td>)}</tr>
        </tbody></table>
      </div>
      <div role="region" aria-label="日別シフト一覧" className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white md:hidden">{!mobileGroups.length && <Empty>この日の選択した表示対象にはドライバーがいません。タブを切り替えてください。</Empty>}{mobileGroups.map(group => <section key={group.key}>{grouped && <h2 className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">{group.name}<span className="ml-2 font-normal">{group.drivers.length}人</span></h2>}{group.drivers.map(d => <div key={d.id} className={cn("flex items-center justify-between gap-3 border-b border-slate-200 px-3", compactRows ? "py-1" : "py-2")}><div className="min-w-0"><button aria-label={`${d.name}の契約設定を開く`} className={cn("min-h-11 text-left text-sm font-medium text-slate-800 hover:underline", showDriverDetails && "mb-1")} onClick={() => navigate({ page: "drivers", driverId: d.id, date: mobileDate })}>{d.name}</button>{showDriverDetails && <div className="flex flex-wrap items-center gap-1"><Labels demo={demo} ids={d.labels}/>{!grouped && <LeaseBadge mode={d.mode}/>}</div>}</div><div className={cn("w-28 shrink-0 rounded-lg", shiftFor(demo, d.id, mobileDate)?.status === "off" && "bg-amber-50")}>{cell(d, mobileDate)}</div></div>)}</section>)}</div>
    </>}
    <p className="mt-3 text-[11px] leading-5 text-slate-500">名前から契約設定、セルから予定・配車を編集できます。表示項目を隠しても予定は変わりません。</p>
    {courseEditing && <CourseAssignments key={`${courseEditing.courseId}-${courseEditing.date}`} demo={demo} setDemo={setDemo} notify={notify} course={demo.courses.find(c => c.id === courseEditing.courseId)!} date={courseEditing.date} drivers={drivers} onClose={() => setCourseEditing(null)}/>}
    {exportOpen && <ShiftExportDialog demo={demo} view={isMobile ? view : { ...view, dayFilter: "all" }} date={mobileDate} onClose={() => setExportOpen(false)}/>}
    {editing && <ShiftEditor key={`${editing.driverId}-${editing.date}`} demo={demo} setDemo={setDemo} notify={notify} confirm={confirm} guard={guard} setDirty={setDirty} navigate={navigate} initialLoanId={editingKey?.loanId} shift={editing} onClose={() => setEditingKey(null)} dateLabel={dateLabel(editing.date)}/>}
  </div>;
}
