"use client";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { courseIdsFor, shiftFor, validateShift, withCourse, type Course, type Driver } from "./model";
import { EditorModal, ErrorMessage, buttonClass, type PageProps } from "./ui";

// shifts/page.tsx の courseCellModal：割当済みから外す／希望休以外の候補を追加する。
export function CourseAssignments({ demo, setDemo, notify, course, date, drivers, onClose }: Pick<PageProps, "demo" | "setDemo" | "notify"> & { course: Course; date: string; drivers: Driver[]; onClose: () => void }) {
  const [error, setError] = useState("");
  const assigned = drivers.filter(d => courseIdsFor(shiftFor(demo, d.id, date)).includes(course.id));
  const available = drivers.filter(d => { const shift = shiftFor(demo, d.id, date); return shift && shift.status !== "off" && !courseIdsFor(shift).includes(course.id); });
  const change = (driver: Driver, add: boolean) => {
    const shift = shiftFor(demo, driver.id, date);
    if (!shift) return;
    const next = withCourse(shift, course.id, add);
    const issue = validateShift(demo, next);
    if (issue) { setError(issue); return; }
    setDemo({ ...demo, shifts: demo.shifts.map(s => s === shift ? next : s) });
    setError(""); notify("シフトをプレビュー内に反映しました");
  };
  return <EditorModal variant="shift" title={`${date}　${course.name}`} onClose={onClose}>
    <h3 className="mb-2 text-xs font-medium text-slate-500">割当済み</h3>
    <div className="space-y-2">{assigned.map(driver => <div key={driver.id} className={`flex items-center justify-between rounded-lg border px-3 text-sm ${course.color}`}><span>{driver.name}</span><button aria-label={`${driver.name}をコースから外す`} className="min-h-11 px-2 text-xs hover:underline" onClick={() => change(driver, false)}>外す</button></div>)}{!assigned.length && <p className="text-xs text-slate-400">割当はありません。</p>}</div>
    <h3 className="mb-2 mt-4 text-xs font-medium text-slate-500">追加するドライバー</h3>
    <div className="flex flex-wrap gap-2">{available.map(driver => <button key={driver.id} aria-label={`${driver.name}をコースに追加`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-xs text-slate-600 hover:bg-slate-50" onClick={() => change(driver, true)}><FontAwesomeIcon icon={faPlus}/>{driver.name}{courseIdsFor(shiftFor(demo, driver.id, date)).length > 0 && <span className="text-[10px] text-slate-400">他コースあり</span>}</button>)}</div>
    {!available.length && <p className="text-xs text-slate-400">追加できるドライバーはいません。</p>}
    <p className="my-3 text-[11px] leading-5 text-slate-400">一覧の絞り込みを引き継ぎます。希望休の人は候補に含みません。</p>
    <ErrorMessage message={error}/><div className="mt-4 flex justify-end border-t border-slate-200 pt-3"><button className={buttonClass} onClick={onClose}>閉じる</button></div>
  </EditorModal>;
}
