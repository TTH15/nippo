"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CustomSelect } from "@/lib/components/CustomSelect";
import type { ImageMemoRead } from "@/lib/shiftMemo/imageImport";
import type { TransferLane } from "@/lib/shiftMemo/transfer";

export function ImageMemoImportDialog({ file, read, lanes, courses, targets, onTargetChange, onClose, onConfirm }: {
  file: File;
  read: ImageMemoRead;
  lanes: TransferLane[];
  courses: { id: string; name: string; summary_title?: string | null }[];
  targets: string[];
  onTargetChange: (index: number, target: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const options = [
    { value: "skip", label: "この行を読み込まない" },
    ...lanes.map(lane => ({ value: `lane:${lane.id}`, label: `${courses.find(course => course.id === lane.routeId)?.summary_title || courses.find(course => course.id === lane.routeId)?.name || ""} / ${lane.name}` })),
    ...courses.map(course => ({ value: `course:${course.id}`, label: `新しい担当枠 / ${course.summary_title || course.name}` })),
  ];
  const count = read.rows.reduce((total, row) => total + row.days.reduce((subtotal, day) => subtotal + day.names.length, 0), 0);
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="image-memo-import-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="border-b border-slate-200 px-5 py-4">
        <h2 id="image-memo-import-title" className="text-lg font-bold text-slate-900">読み取り結果を確認</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600"><span>{file.name} · {read.period.year}年{read.period.month}月 · {read.rows.length}枠・{count}枚</span>
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-slate-800 underline underline-offset-2">元ファイルを見る</a>}
        </div>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto p-5">
        {read.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{read.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
        {read.rows.map((row, index) => <div key={`${row.name}-${index}`} className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">{row.name}</h3><span className="text-xs text-slate-500">{row.days.length}日</span></div>
          <CustomSelect ariaLabel={`${row.name}の読み込み先`} value={targets[index] ?? ""} placeholder="読み込み先を選択" options={options}
            onChange={value => onTargetChange(index, value)} />
          <div className="mt-2 max-h-28 overflow-y-auto text-xs leading-6 text-slate-600">
            {row.days.map(day => <p key={day.day}>{read.period.month}月{day.day}日　{day.names.join("、") || "配置なし"}</p>)}
          </div>
        </div>)}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <span className="mr-auto text-xs text-slate-600">対象セルの配置を置き換えます</span>
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">戻る</button>
        <button type="button" disabled={targets.some(target => !target) || targets.every(target => target === "skip")} onClick={onConfirm} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40">メモに読み込む</button>
      </footer>
    </section>
  </div>, document.body);
}
