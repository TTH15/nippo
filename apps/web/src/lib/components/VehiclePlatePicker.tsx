"use client";

import { useId, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { SmoothCollapse } from "./SmoothCollapse";
import { VehiclePlate, type VehiclePlateData } from "./VehiclePlate";
import { cn } from "@/lib/ui/utils";

export type VehiclePlateOption = {
  vehicle: VehiclePlateData;
  name: string;
  description?: string;
  disabled?: boolean;
};

const plateName = (vehicle: VehiclePlateData) =>
  [vehicle.number_prefix, vehicle.number_class, vehicle.number_hiragana, vehicle.number_numeric].filter(Boolean).join(" ") || "ナンバー未設定";
const searchKey = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s-]/g, "");

/** シフト画面のVehicleOptionListと同じプレート描画。保存・利用可否は呼び出し側が決める。 */
export function VehiclePlatePicker({ label, value, options, onChange, emptyLabel = "車両なし" }: {
  label: string;
  value: string;
  options: VehiclePlateOption[];
  onChange: (id: string) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = options.find(option => option.vehicle.id === value);
  const visible = options.filter(option => searchKey(`${plateName(option.vehicle)} ${option.name}`).includes(searchKey(query)));
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  };
  return <div className="min-w-0" onKeyDown={event => {
    if (open && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(""); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} id={`${id}-trigger`} type="button" aria-label={label} aria-describedby={`${id}-selection`} aria-expanded={open} aria-controls={`${id}-options`} onClick={() => setOpen(current => !current)}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
      {selected && <VehiclePlate vehicle={selected.vehicle} compact className="w-[88px] shrink-0 pointer-events-none"/>}
      <span id={`${id}-selection`} className="min-w-0 flex-1 text-xs text-slate-700">
        {selected ? <><span className="sr-only">{plateName(selected.vehicle)} </span><span className="block break-words">{selected.name}</span>{selected.description && <span className="mt-0.5 block text-[11px] text-amber-800">{selected.description}</span>}</> : value ? "選択済みの車両が見つかりません" : emptyLabel}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-500">{open ? "閉じる" : selected ? "変更" : "選ぶ"}<FontAwesomeIcon icon={faChevronDown} rotation={open ? 180 : undefined}/></span>
    </button>
    <SmoothCollapse open={open} id={`${id}-options`} labelledBy={`${id}-trigger`}>
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-3 flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white pl-3 focus-within:ring-1 focus-within:ring-slate-400">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="shrink-0 text-xs text-slate-400"/>
          <input aria-label={`${label}を番号・車種で検索`} placeholder="番号・車種で検索" value={query} onChange={event => setQuery(event.target.value)} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"/>
          <button type="button" aria-label="車両の検索をクリア" disabled={!query} onClick={() => setQuery("")} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 disabled:invisible"><FontAwesomeIcon icon={faXmark}/></button>
        </div>
        <button type="button" aria-pressed={!value} onClick={() => choose("")} className={cn("mb-3 min-h-11 rounded-lg border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400", !value ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100")}>{emptyLabel}</button>
        <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3" aria-label="車両の候補">
          {visible.map(option => <button key={option.vehicle.id} type="button" aria-label={`${plateName(option.vehicle)}を選択`} aria-pressed={value === option.vehicle.id} disabled={option.disabled} onClick={() => choose(option.vehicle.id)}
            className={cn("flex min-h-11 min-w-0 flex-col items-center gap-1.5 rounded-lg border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400", value === option.vehicle.id ? "border-slate-800 bg-slate-200 ring-1 ring-slate-800" : "border-slate-200 bg-white hover:bg-slate-100", option.disabled && "cursor-not-allowed opacity-50")}>
            <VehiclePlate vehicle={option.vehicle} compact className="!max-w-[128px] w-full pointer-events-none"/>
            <span className="text-xs leading-4 text-slate-700">{option.name}</span>
            {option.description && <span className="text-[11px] leading-4 text-amber-800">{option.description}</span>}
          </button>)}
        </div>
        {!visible.length && <p role="status" className="py-4 text-center text-xs text-slate-500">{options.length ? "該当する車両がありません。検索条件を変えてください。" : "登録されている車両がありません。"}</p>}
      </div>
    </SmoothCollapse>
  </div>;
}
