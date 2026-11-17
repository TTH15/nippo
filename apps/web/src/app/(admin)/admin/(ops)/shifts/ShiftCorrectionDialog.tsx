"use client";
import { useState } from "react";
import { EditorModal } from "@/lib/components/EditorModal";
import { apiFetch } from "@/lib/api";

export function ShiftCorrectionDialog({ driverId, driverName, date, canUnlock, unavailable = false, onClose, onOpened }: {
  driverId: string; driverName: string; date: string; canUnlock: boolean; unavailable?: boolean; onClose: () => void; onOpened: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try {
      await apiFetch("/api/admin/shifts/corrections", { method: "POST", body: JSON.stringify({ driverId, date }) });
      await onOpened(); onClose();
    } catch (value) { setError(value instanceof Error ? value.message : "確定を解除できませんでした"); }
    finally { setBusy(false); }
  };
  return <EditorModal title={canUnlock ? "過去のシフトを変更しますか？" : "シフトの変更"} variant="shift" onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-3 px-4 py-4">
      {unavailable ? <><p role="alert" className="text-sm text-slate-600">確定状態を読み込めませんでした。</p><button type="button" onClick={() => void onOpened()} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm">再読み込み</button></> : canUnlock ? <><p className="text-sm text-slate-700">{driverName}</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm">キャンセル</button><button type="button" disabled={busy} onClick={() => void submit()} className="min-h-11 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-50">変更する</button></div>
      </> : <p className="text-sm text-slate-600">管理者に修正を依頼してください。</p>}
    </div>
  </EditorModal>;
}
