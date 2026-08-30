"use client";

import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/ui/utils";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "className" | "size"> & {
  label: string;
  onSelect: () => void;
};

/** CheckboxFieldと同じ配色・押下反応。標準radioの矢印キー操作を維持する。 */
export function RadioField({ label, onSelect, checked, disabled, id, ...props }: Props) {
  const generatedId = useId();
  return <label htmlFor={id ?? generatedId} className={cn("group relative block select-none", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
    <input {...props} id={id ?? generatedId} type="radio" className="peer sr-only" checked={checked} disabled={disabled} onChange={onSelect}/>
    <span className={cn("flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50", checked ? "border-amber-200 bg-amber-50/70 text-slate-900" : "border-slate-200 bg-white text-slate-600", !disabled && (checked ? "group-hover:bg-amber-50" : "group-hover:border-slate-300 group-hover:bg-slate-50"))}>
      <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border shadow-sm transition-[transform,background-color,border-color] duration-150 motion-reduce:transition-none", checked ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white", !disabled && "group-active:scale-90 motion-reduce:group-active:scale-100")}>
        <span className={cn("size-2 rounded-full bg-amber-300 transition-[opacity,transform] duration-150 motion-reduce:transition-none", checked ? "scale-100 opacity-100" : "scale-75 opacity-0")}/>
      </span>
      <span className="min-w-0 break-words leading-6">{label}</span>
    </span>
  </label>;
}
