"use client";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { MODE_NAMES, type Demo } from "./model";
import type { ShiftView } from "./navigation";
import { SelectionToggle } from "./SelectionToggle";
import { useMobileLayout } from "./useMobileLayout";

export function ShiftFilters({ demo, view, update, count }: { demo: Demo; view: ShiftView; update: (patch: Partial<ShiftView>) => void; count: number }) {
  const mobile = useMobileLayout();
  const [labelsOpen, setLabelsOpen] = useState(false);
  const labels = [...demo.labels, { id: "unlabeled", name: "ラベル未設定" }];
  const selected = labels.filter(label => view.labelIds.includes(label.id));
  const summary = selected.length ? `${selected[0].name}${selected.length > 1 ? ` ほか${selected.length - 1}件` : ""}` : "すべて";
  const toggleLabel = (id: string) => update({ labelIds: view.labelIds.includes(id) ? view.labelIds.filter(label => label !== id) : [...view.labelIds, id] });
  return <section className="my-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5" aria-label="シフトの絞り込み">
    {mobile && <button id="shift-label-toggle" type="button" aria-label="ラベルで絞り込む" aria-describedby="shift-label-summary" aria-expanded={labelsOpen} aria-controls="shift-label-options" onClick={() => setLabelsOpen(open => !open)} className="flex min-h-8 w-full min-w-0 items-center gap-2 text-xs text-slate-600">
      <span className="shrink-0 font-medium">ラベル</span><span id="shift-label-summary" className="min-w-0 flex-1 truncate text-right text-slate-800">{summary}</span><FontAwesomeIcon icon={faChevronDown} rotation={labelsOpen ? 180 : undefined} className="ml-1 shrink-0"/>
    </button>}
    <SmoothCollapse open={!mobile || labelsOpen} id="shift-label-options" labelledBy={mobile ? "shift-label-toggle" : undefined}>
    <div className="flex flex-wrap items-center gap-1.5 py-1 md:py-0" role="group" aria-label="ラベルで絞り込み" aria-describedby="label-filter-help">
      {!mobile && <span className="mr-1 text-xs font-medium text-slate-500">ラベル</span>}
      <SelectionToggle compact selected={!view.labelIds.length} onClick={() => update({ labelIds: [] })}>すべて</SelectionToggle>
      {labels.map(label => <SelectionToggle compact key={label.id} selected={view.labelIds.includes(label.id)} onClick={() => toggleLabel(label.id)}>{label.name}</SelectionToggle>)}
      <span id="label-filter-help" className="sr-only">複数選択可・いずれかに一致</span>
    </div>
    </SmoothCollapse>
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto" role="group" aria-label="契約区分の表示">
        <div className="min-w-0 flex-1 sm:w-40 sm:flex-none"><CustomSelect ariaLabel="リース区分で絞り込み" value={view.mode} onChange={mode => update({ mode })} size="sm" clearable={false} triggerClassName="!h-11 !min-h-11 !rounded-lg !border !border-slate-200 !text-xs" options={[{ value: "all", label: "すべての契約" }, ...Object.entries(MODE_NAMES).map(([value, label]) => ({ value, label }))]}/></div>
        {view.axis === "driver" && <CheckboxField label="契約区分でまとめる" checked={view.grouped} onCheckedChange={grouped => update({ grouped })} className="shrink-0 whitespace-nowrap [&>span]:h-11 [&>span]:gap-2 [&>span]:px-2.5 [&>span]:py-0 [&>span]:text-xs"/>}
      </div>
      <label className="flex h-11 min-w-32 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-100 sm:ml-2 sm:max-w-60"><FontAwesomeIcon icon={faMagnifyingGlass} className="h-3.5 w-3.5 text-slate-400"/><input aria-label="ドライバーを検索" placeholder="名前で検索" value={view.query} onChange={event => update({ query: event.target.value })} className="h-full w-full min-w-0 bg-transparent text-xs outline-none"/></label>
      <span className="ml-auto whitespace-nowrap text-xs text-slate-500">{count}人 / 全{demo.drivers.length}人</span>
    </div>
  </section>;
}
