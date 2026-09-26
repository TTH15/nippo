"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCamera, faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { PHOTO_CAPTURE_PRESETS, PHOTO_CAPTURE_STAGES, type PhotoCaptureStage, type PhotoCaptureTask } from "@repo/core/logic/photoCapturePolicy";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { CheckboxField } from "@/lib/components/CheckboxField";

type Response = { tasks: PhotoCaptureTask[]; version: number };

export function PhotoCaptureTasksEditor({ canWrite }: { canWrite: boolean }) {
  const { data, error: loadError, mutate } = useApi<Response>("/api/admin/photo-capture-tasks", { revalidateOnFocus: false });
  const [tasks, setTasks] = useState<PhotoCaptureTask[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newStage, setNewStage] = useState<PhotoCaptureStage>("parking");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (data) setTasks(data.tasks); }, [data]);

  const add = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 40 || tasks.length >= 20) return;
    setTasks(prev => [...prev, { id: crypto.randomUUID(), label: trimmed, stage: newStage, required: false }]);
    setNewLabel("");
    setMessage("");
  };
  const update = (id: string, patch: Partial<PhotoCaptureTask>) =>
    setTasks(prev => prev.map(task => task.id === id ? { ...task, ...patch } : task));
  const save = async () => {
    if (!data) return;
    setSaving(true); setMessage("");
    try {
      await apiFetch("/api/admin/photo-capture-tasks", { method: "PUT", body: JSON.stringify({ tasks, version: data.version }) });
      await mutate();
      setMessage("撮影項目を保存しました");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存できませんでした"); }
    finally { setSaving(false); }
  };

  return <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6" aria-label="撮影項目">
    <div className="mb-5 flex items-center gap-2"><FontAwesomeIcon icon={faCamera} className="h-4 w-4 text-slate-600" /><h2 className="text-base font-bold text-slate-900">撮影項目</h2></div>
    <div className="mb-5 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
      <div className="rounded-lg bg-slate-50 px-3 py-2">稼働開始　メーター</div>
      <div className="rounded-lg bg-slate-50 px-3 py-2">業務終了　車両の前・右・後・左</div>
      <div className="rounded-lg bg-slate-50 px-3 py-2">駐車　メーター</div>
    </div>
    {loadError && <p role="alert" className="text-sm text-red-700">撮影項目を読み込めませんでした</p>}
    <div className="space-y-2">
      {tasks.map(task => <div key={task.id} className="grid items-center gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_8rem_auto_auto]">
        <input aria-label="撮影するもの" value={task.label} disabled={!canWrite} maxLength={40} onChange={event => update(task.id, { label: event.target.value })} className="min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        <select aria-label={`${task.label}の撮影時点`} value={task.stage} disabled={!canWrite} onChange={event => update(task.id, { stage: event.target.value as PhotoCaptureStage })} className="min-h-10 rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50">
          {PHOTO_CAPTURE_STAGES.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
        </select>
        <CheckboxField label="必須" checked={task.required} disabled={!canWrite} onCheckedChange={checked => update(task.id, { required: checked })} />
        {canWrite && <button type="button" aria-label={`${task.label}を削除`} onClick={() => setTasks(prev => prev.filter(item => item.id !== task.id))} className="min-h-10 rounded-md px-3 text-slate-500 hover:bg-slate-100"><FontAwesomeIcon icon={faTrashCan} /></button>}
      </div>)}
    </div>
    {canWrite && <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
      <div className="flex flex-wrap gap-2">{PHOTO_CAPTURE_PRESETS.map(label => <button key={label} type="button" disabled={tasks.length >= 20} onClick={() => add(label)} className="min-h-10 rounded-full border border-slate-300 px-3 text-sm text-slate-700 disabled:opacity-50"><FontAwesomeIcon icon={faPlus} className="mr-1.5 text-xs" />{label}</button>)}</div>
      <div className="flex flex-wrap gap-2"><input aria-label="追加する撮影項目" placeholder="その他の写真" value={newLabel} maxLength={40} onChange={event => setNewLabel(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm" /><select aria-label="追加する撮影時点" value={newStage} onChange={event => setNewStage(event.target.value as PhotoCaptureStage)} className="min-h-10 rounded-md border border-slate-300 px-2 text-sm">{PHOTO_CAPTURE_STAGES.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select><button type="button" disabled={!newLabel.trim() || tasks.length >= 20} onClick={() => add(newLabel)} className="min-h-10 rounded-md border border-slate-300 px-4 text-sm disabled:opacity-50">追加</button></div>
    </div>}
    {tasks.some(task => task.required) && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">必須項目は、更新前のアプリには表示されません。アプリ配布後に有効にしてください。</p>}
    {message && <p role={message.includes("保存しました") ? "status" : "alert"} className="mt-3 text-sm text-slate-700">{message}</p>}
    {canWrite && <div className="mt-5 flex justify-end"><button type="button" disabled={!data || saving || tasks.some(task => !task.label.trim())} onClick={() => void save()} className="min-h-11 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white disabled:opacity-50">{saving ? "保存中…" : "撮影項目を保存"}</button></div>}
  </section>;
}
