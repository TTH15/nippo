"use client";

import { useState } from "react";
import { EditorModal } from "./EditorModal";
import { SortableList } from "./SortableList";
import { ShiftLeaseBadge } from "./ShiftLeaseFilters";
import type { ShiftLeaseMode } from "@/lib/shiftLease";
import { cn } from "@/lib/ui/utils";

export type ShiftDriverOrderItem = {
  id: string;
  name: string;
  leaseMode: ShiftLeaseMode | null;
  courseName: string | null;
  courseColor: string | null;
  courseOrder: number | null;
};

export function sortShiftDriverOrder(
  items: ShiftDriverOrderItem[],
  by: "lease" | "course",
): ShiftDriverOrderItem[] {
  const currentRank = new Map(items.map((item, index) => [item.id, index]));
  const leaseRank: Record<ShiftLeaseMode, number> = { MONTHLY: 0, DAILY: 1, NONE: 2 };
  return [...items].sort((a, b) => {
    const result = by === "lease"
      ? (a.leaseMode ? leaseRank[a.leaseMode] : 3) - (b.leaseMode ? leaseRank[b.leaseMode] : 3)
      : (a.courseOrder ?? Number.MAX_SAFE_INTEGER) - (b.courseOrder ?? Number.MAX_SAFE_INTEGER)
        || (a.courseName ?? "").localeCompare(b.courseName ?? "", "ja");
    return result || (currentRank.get(a.id) ?? 0) - (currentRank.get(b.id) ?? 0);
  });
}

export function ShiftDriverOrderDialog({ items, dateLabel, onSave, onClose }: {
  items: ShiftDriverOrderItem[];
  dateLabel: string;
  onSave: (ids: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(items);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      await onSave(draft.map(item => item.id));
      onClose();
    } catch {
      setError("並び順を保存できませんでした。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40";
  return <EditorModal title="シフト表の行を並べ替える" variant="shift" onClose={onClose} footer={
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className={cn(buttonClass, "border-slate-300 bg-white text-slate-700")} disabled={saving} onClick={onClose}>キャンセル</button>
      <button type="button" className={cn(buttonClass, "border-slate-800 bg-slate-800 text-white")} disabled={saving || draft.length === 0} onClick={() => void save()}>{saving ? "保存中…" : "並び順を保存"}</button>
    </div>
  }>
    <p className="text-xs leading-5 text-slate-500">シフト表と日別画像で共通の順番です。{dateLabel}のコースを見ながら調整できます。</p>
    <div role="group" aria-label="並び順の下書き" className="my-3 flex flex-wrap gap-2">
      <button type="button" className={cn(buttonClass, "border-slate-300 bg-white text-slate-700")} disabled={saving} onClick={() => setDraft(current => sortShiftDriverOrder(current, "lease"))}>契約区分でまとめる</button>
      <button type="button" className={cn(buttonClass, "border-slate-300 bg-white text-slate-700")} disabled={saving} onClick={() => setDraft(current => sortShiftDriverOrder(current, "course"))}>{dateLabel}のコースでまとめる</button>
    </div>
    {error && <p role="alert" className="mb-3 text-xs text-red-700">{error}</p>}
    <SortableList label="シフト表の行" items={draft} onReorder={setDraft} getLabel={item => item.name} className="space-y-2" itemClassName={() => "!rounded-lg"}>
      {(item, handle) => <div className="flex min-h-12 items-center gap-2 pr-3">
        {handle}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{item.name}</span>
        <span className="max-w-28 truncate rounded px-2 py-1 text-[11px] font-semibold text-slate-800" style={{ backgroundColor: item.courseColor ? `${item.courseColor}55` : "#f1f5f9" }}>
          {item.courseName ?? "コース未割当"}
        </span>
        <span className="w-20 shrink-0"><ShiftLeaseBadge mode={item.leaseMode} /></span>
      </div>}
    </SortableList>
  </EditorModal>;
}
