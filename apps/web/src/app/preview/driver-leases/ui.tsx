"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { VehiclePlate, type VehiclePlateData } from "@/lib/components/VehiclePlate";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { cn } from "@/lib/ui/utils";
import { MODE_NAMES, type Demo, type LeaseMode, type Vehicle } from "./model";
import type { PreviewTarget } from "./navigation";

export const inputClass = "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100";
export const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40";
export const primaryClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-800 px-5 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-40";
export type Confirm = (title: string, message: string, action: () => void, confirmLabel: string) => void;
export type PageProps = { demo: Demo; setDemo: (demo: Demo) => void; notify: (message: string) => void; setDirty: (dirty: boolean) => void; guard: (action: () => void) => void; confirm: Confirm; target: PreviewTarget; navigate: (target: PreviewTarget, saved?: boolean) => void; replaceTarget: (target: PreviewTarget) => void };

export function Choice({ label, value, onChange, options, className, disabled }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string; description?: string }[]; className?: string; disabled?: boolean }) {
  return <div className={className}><CustomSelect ariaLabel={label} value={value} onChange={onChange} options={options} clearable={false} disabled={disabled} triggerClassName="min-h-11" /></div>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><div className="text-xs font-medium text-slate-600">{label}</div>{children}</div>;
}
export function LeaseBadge({ mode }: { mode: LeaseMode }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold", mode === "MONTHLY" ? "border-slate-300 bg-slate-100 text-slate-700" : mode === "DAILY" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-500")}>{MODE_NAMES[mode]}</span>;
}
export function Labels({ demo, ids }: { demo: Demo; ids: string[] }) {
  return <span className="flex flex-wrap gap-1">{ids.length === 0 ? <span className="text-[11px] text-slate-400">ラベル未設定</span> : ids.map(id => { const label = demo.labels.find(l => l.id === id); return label ? <span key={id} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] leading-4 text-slate-500">{label.name}</span> : null; })}</span>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">{children}</div>; }
export function ErrorMessage({ message }: { message: string }) { return message ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p> : null; }

export function demoPlateData(vehicle: Vehicle): VehiclePlateData {
  const [number_prefix, number_class, number_hiragana, number_numeric] = vehicle.plate.split(" ");
  return { id: vehicle.id, number_prefix, number_class, number_hiragana, number_numeric, plate_color: "black" };
}
export function DemoPlate({ vehicle, className }: { vehicle: Vehicle; className?: string }) {
  return <VehiclePlate vehicle={demoPlateData(vehicle)} compact className={className} />;
}

// users/page.tsx の編集モーダルと同じ外枠・サイズ。データ保存のみローカルに置換。
export function EditorModal({ title, children, footer, onClose, variant = "driver" }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; variant?: "driver" | "shift" }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBodyScrollLock(true);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (event.key === "Escape" && !event.defaultPrevented && dialogs[dialogs.length - 1] === panel.current) closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); previous?.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("modal-panel-in flex max-h-[85vh] w-full flex-col bg-white text-slate-800 shadow-lg outline-none", variant === "shift" ? "max-w-xl rounded-xl" : "max-w-2xl rounded-lg p-5")} onClick={event => event.stopPropagation()}>
      <div className={cn("flex shrink-0 items-center justify-between gap-3", variant === "shift" ? "border-b border-slate-200 px-4 py-3" : "mb-4")}><h2 id={titleId} className={cn("font-semibold text-slate-900", variant === "shift" ? "text-sm" : "text-lg")}>{title}</h2><button aria-label="編集を閉じる" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded text-slate-500 hover:bg-slate-100"><FontAwesomeIcon icon={faXmark}/></button></div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", variant === "shift" ? "p-4" : "-mr-1 pr-1")}>{children}</div>
      {footer && <div className={cn("shrink-0 border-t border-slate-100", variant === "shift" ? "px-4 py-3" : "mt-4 pt-3")}>{footer}</div>}
    </div>
  </div>, document.body);
}
