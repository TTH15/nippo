"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { DatePicker } from "@/lib/components/DatePicker";
import { reportDateStrToDate, dateToReportDateStr } from "@/lib/date";
import type { EventDetailData, EventStatus } from "./types";
import { STATUS_LABEL } from "./types";

export function EventSettingsTab({
  event,
  canWrite,
  onSaved,
  onDeleted,
  onError,
  onConfirm,
}: {
  event: EventDetailData;
  canWrite: boolean;
  onSaved: () => void;
  onDeleted: () => void;
  onError: (title: string, message: string) => void;
  onConfirm: (message: string, onOk: () => void) => void;
}) {
  const [name, setName] = useState(event.name);
  const [description, setDescription] = useState(event.description);
  const [startsOn, setStartsOn] = useState(event.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(event.ends_on ?? "");
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(event.name);
    setDescription(event.description);
    setStartsOn(event.starts_on ?? "");
    setEndsOn(event.ends_on ?? "");
    setStatus(event.status);
  }, [event]);

  const dirty =
    name !== event.name ||
    description !== (event.description ?? "") ||
    startsOn !== (event.starts_on ?? "") ||
    endsOn !== (event.ends_on ?? "") ||
    status !== event.status;

  const save = async () => {
    if (!canWrite) return;
    if (!name.trim()) {
      onError("入力エラー", "イベント名は必須です。");
      return;
    }
    if (startsOn && endsOn && startsOn > endsOn) {
      onError("入力エラー", "開始日は終了日より前にしてください。");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          description,
          starts_on: startsOn || null,
          ends_on: endsOn || null,
          status,
        }),
      });
      onSaved();
    } catch (e) {
      onError("保存に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!canWrite) return;
    onConfirm(`イベント「${event.name}」を削除しますか？チーム・割当・加点もすべて削除されます。`, async () => {
      try {
        await apiFetch(`/api/admin/events/${event.id}`, { method: "DELETE" });
        onDeleted();
      } catch (e) {
        onError("削除に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
      }
    });
  };

  const inputCls =
    "w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400";

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">イベント名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canWrite}
          className={inputCls}
          placeholder="例：5月チーム対抗戦"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">説明</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!canWrite}
          rows={2}
          className={inputCls}
          placeholder="任意"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">開始日</label>
          <DatePicker
            value={startsOn ? reportDateStrToDate(startsOn) : undefined}
            onChange={(d) => canWrite && setStartsOn(d ? dateToReportDateStr(d) : "")}
            placeholder="開始日を選択"
            toDate={endsOn ? reportDateStrToDate(endsOn) : undefined}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">終了日</label>
          <DatePicker
            value={endsOn ? reportDateStrToDate(endsOn) : undefined}
            onChange={(d) => canWrite && setEndsOn(d ? dateToReportDateStr(d) : "")}
            placeholder="終了日を選択"
            fromDate={startsOn ? reportDateStrToDate(startsOn) : undefined}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500 -mt-2">
        ※ 採点は「開始日〜終了日」の承認済み日報を対象にします。期間未設定だとランキングは計算されません。
      </p>

      <div className="w-48">
        <label className="block text-xs font-medium text-slate-600 mb-1">ステータス</label>
        <CustomSelect
          options={(["draft", "active", "closed"] as EventStatus[]).map((s) => ({
            value: s,
            label: STATUS_LABEL[s],
          }))}
          value={status}
          onChange={(v) => setStatus(v as EventStatus)}
          clearable={false}
          disabled={!canWrite}
          size="sm"
        />
      </div>

      {canWrite && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={remove}
            className="text-sm text-rose-600 hover:text-rose-700"
          >
            イベントを削除
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      )}
    </div>
  );
}
