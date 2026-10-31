"use client";

import { useEffect, useRef, useState } from "react";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { EditorModal } from "@/lib/components/EditorModal";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { useDialogTabLoop } from "@/lib/hooks/useDialogTabLoop";
import { resolveDayActivity, type DayOverride } from "@/lib/shiftMemo/board";
import { imageMemoTargetIssues, type ImageMemoRead, type ImageMemoDriver } from "@/lib/shiftMemo/imageImport";
import type { TransferLane } from "@/lib/shiftMemo/transfer";

export function ImageMemoImportDialog({ file, read, lanes, courses, drivers, dayOverrides, dayOffByDate, targets, error, onTargetChange, onClose, onConfirm }: {
  file: File; read: ImageMemoRead; lanes: TransferLane[];
  courses: { id: string; name: string; summary_title?: string | null }[];
  drivers: ImageMemoDriver[]; dayOverrides: Record<string, DayOverride>; dayOffByDate: Map<string, Set<string>>;
  targets: string[]; error?: string;
  onTargetChange: (index: number, target: string) => void;
  onClose: () => void; onConfirm: (activateDays: boolean) => void;
}) {
  useDialogTabLoop();
  const [sourceUrl, setSourceUrl] = useState("");
  const [activateDays, setActivateDays] = useState(true);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const url = URL.createObjectURL(file); setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const options = [
    { value: "skip", label: "この行を読み込まない" },
    ...lanes.map(lane => ({ value: `lane:${lane.id}`, label: `${courses.find(course => course.id === lane.routeId)?.summary_title || courses.find(course => course.id === lane.routeId)?.name || ""} / ${lane.name}` })),
    ...courses.map(course => ({ value: `course:${course.id}`, label: `新しい担当枠 / ${course.summary_title || course.name}` })),
  ];
  const issues = imageMemoTargetIssues(read, targets, lanes, courses);
  const allSkipped = targets.length === read.rows.length && targets.every(target => target === "skip");
  const dateFor = (day: number) => `${read.period.year}-${String(read.period.month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const inactive = read.rows.flatMap((row,index) => {
    const lane = targets[index]?.startsWith("lane:") ? lanes.find(lane => lane.id === targets[index].slice(5)) : undefined;
    return lane ? row.days.filter(day => !resolveDayActivity(lane.activeWeekdays,new Date(`${dateFor(day.day)}T12:00:00`).getDay(),dayOverrides[`${lane.id}|${dateFor(day.day)}`]).active).map(day => `${read.period.month}月${day.day}日 ${row.name}`) : [];
  });
  const offWarnings = read.rows.flatMap((row,index) => targets[index] === "skip" ? [] : row.days.flatMap(day => day.names.filter(name => {
    const normalize = (value: string) => value.normalize("NFKC").replace(/[\s　]/g,"").toLowerCase();
    const matches = drivers.filter(driver => [driver.name,driver.display_name ?? ""].some(label => normalize(label) === normalize(name)));
    return matches.length === 1 && dayOffByDate.get(dateFor(day.day))?.has(matches[0].id);
  }).map(name => `${read.period.month}月${day.day}日 ${name}`)));
  const invalid = issues.length > 0 || allSkipped;
  const fixFirst = () => {
    const row = rowRefs.current[issues[0]?.row ?? 0];
    row?.scrollIntoView({ block: "center" }); row?.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const count = read.rows.reduce((total,row) => total + row.days.reduce((sum,day) => sum + day.names.length,0),0);
  return <EditorModal title="読み取り結果を確認" onClose={onClose} footer={<div className="space-y-2">
    {invalid && <div className="flex flex-wrap items-center gap-2 text-xs text-rose-700" role="status" id="image-import-reason">
      <span>{allSkipped ? "読み込む行を選んでください" : `${issues.length}件の読み込み先を確認してください`}</span>
      <button type="button" onClick={fixFirst} className="min-h-11 font-semibold underline underline-offset-2">読み込み先へ</button>
    </div>}
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="mr-auto text-xs text-slate-600">対象セルの配置を置き換えます</span>
      <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">戻る</button>
      <button type="button" disabled={invalid} aria-describedby={invalid ? "image-import-reason" : undefined} onClick={() => onConfirm(activateDays)} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40">メモに読み込む</button>
    </div>
  </div>}>
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-slate-600"><span className="break-all">{file.name} · {read.period.year}年{read.period.month}月 · {read.rows.length}枠・{count}枚</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">元ファイルを見る</a>}</div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {read.warnings.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{read.warnings.map((warning,index) => <p key={index}>{warning}</p>)}</div>}
      {offWarnings.length > 0 && <section className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><h3 className="font-semibold">希望休との重なり</h3><ul>{offWarnings.map((warning,index) => <li key={index}>{warning}</li>)}</ul><p className="mt-1">希望休を残して配置します。</p></section>}
      {inactive.length > 0 && <section className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><h3 className="font-semibold">担当枠が休みの日</h3><p>{inactive.join("、")}</p><CheckboxField label="配置がある日を稼働にする" checked={activateDays} onCheckedChange={setActivateDays}/></section>}
      {read.rows.map((row,index) => <div ref={node => { rowRefs.current[index] = node; }} key={`${row.name}-${index}`} className={`rounded-xl border p-3 ${issues.some(issue => issue.row === index) ? "border-rose-300" : "border-slate-200"}`}>
        <div className="mb-2 flex items-baseline justify-between gap-2"><h3 className="break-words text-sm font-bold text-slate-900">{row.name}</h3><span className="shrink-0 text-xs text-slate-500">{row.days.length}日</span></div>
        <CustomSelect ariaLabel={`${row.name}の読み込み先`} value={targets[index] ?? ""} placeholder="読み込み先を選択" options={options} onChange={value => onTargetChange(index,value)}/>
        {issues.filter(issue => issue.row === index).map(issue => <p key={issue.message} className="mt-1 text-xs text-rose-700">{issue.message}</p>)}
        <div className="mt-2 max-h-28 overflow-y-auto text-xs leading-6 text-slate-600">{row.days.map(day => <p key={day.day}>{read.period.month}月{day.day}日　{day.names.join("、") || "配置なし"}</p>)}</div>
      </div>)}
    </div>
  </EditorModal>;
}
