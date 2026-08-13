"use client";

import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faXmark, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { DatePicker } from "@/lib/components/DatePicker";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { TimePicker } from "@/lib/ui/time-picker";
import { reportDateStrToDate, dateToReportDateStr } from "@/lib/date";
import {
  STATUS_LABEL,
  type MemberCandidate,
  type SpotJob,
  type SpotJobSavePayload,
  type SpotJobStatus,
} from "./types";

// 参加者の下書き行。type="driver" は登録メンバー（正規/ゲスト）の選択、
// type="name" は「名前だけの同行者」（work-model §3: display_name のみの行）。
type MemberDraft = {
  key: string;
  type: "driver" | "name";
  driverId: string;
  displayName: string;
  payAmount: string;
};

let draftSeq = 0;
const nextKey = () => `m${draftSeq++}`;

function toDrafts(job: SpotJob | undefined): MemberDraft[] {
  if (!job) return [];
  return job.members.map((m) => ({
    key: nextKey(),
    type: m.driverId ? "driver" : "name",
    driverId: m.driverId ?? "",
    displayName: m.displayName ?? "",
    payAmount: m.payAmount != null ? String(m.payAmount) : "",
  }));
}

export function SpotJobModal({
  mode,
  initial,
  defaultDate,
  drivers,
  onSave,
  onClose,
  createGuest,
}: {
  mode: "create" | "edit";
  initial?: SpotJob;
  defaultDate: string; // YYYY-MM-DD（create 時の初期日付）
  drivers: MemberCandidate[];
  onSave: (payload: SpotJobSavePayload) => Promise<void>;
  onClose: () => void;
  createGuest: (name: string) => Promise<MemberCandidate>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState<Date | undefined>(reportDateStrToDate(initial?.jobDate ?? defaultDate));
  const [meetingTime, setMeetingTime] = useState<string | null>(initial?.meetingTime ?? null);
  const [endTime, setEndTime] = useState<string | null>(initial?.endTime ?? null);
  const [meetingPlace, setMeetingPlace] = useState(initial?.meetingPlace ?? "");
  const [clientName, setClientName] = useState(initial?.clientName ?? "");
  const [billingAmount, setBillingAmount] = useState(initial?.billingAmount != null ? String(initial.billingAmount) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [status, setStatus] = useState<SpotJobStatus>(initial?.status ?? "planned");
  const [members, setMembers] = useState<MemberDraft[]>(() => toDrafts(initial));
  const [guestName, setGuestName] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const driverOptions = useMemo(
    () => drivers.map((d) => ({ value: d.id, label: d.isGuest ? `${d.name}（ゲスト）` : d.name })),
    [drivers],
  );

  const setMember = (key: string, patch: Partial<MemberDraft>) =>
    setMembers((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  const removeMember = (key: string) => setMembers((prev) => prev.filter((m) => m.key !== key));

  async function addGuest() {
    const name = guestName.trim();
    if (!name || guestBusy) return;
    setGuestBusy(true);
    setError(null);
    try {
      const guest = await createGuest(name);
      setMembers((prev) => [
        ...prev,
        { key: nextKey(), type: "driver", driverId: guest.id, displayName: "", payAmount: "" },
      ]);
      setGuestName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ゲストの作成に失敗しました");
    } finally {
      setGuestBusy(false);
    }
  }

  async function save() {
    if (saving) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("案件名を入力してください");
      return;
    }
    if (!date) {
      setError("日付を選択してください");
      return;
    }
    const payload: SpotJobSavePayload = {
      title: trimmedTitle,
      jobDate: dateToReportDateStr(date),
      meetingPlace: meetingPlace.trim() || null,
      meetingTime,
      endTime,
      clientName: clientName.trim() || null,
      billingAmount: billingAmount.trim() === "" ? null : Number(billingAmount),
      note: note.trim() || null,
      status,
      members: members
        .filter((m) => (m.type === "driver" ? m.driverId : m.displayName.trim()))
        .map((m) => ({
          driverId: m.type === "driver" ? m.driverId : null,
          displayName: m.type === "name" ? m.displayName.trim() : null,
          payAmount: m.payAmount.trim() === "" ? null : Number(m.payAmount),
        })),
    };
    setSaving(true);
    setError(null);
    try {
      await onSave(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="modal-panel-in bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            単発案件を{mode === "create" ? "追加" : "編集"}
          </h2>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm overflow-y-auto">
          <Field label="案件名">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2 py-1.5 border border-slate-300 rounded"
              placeholder="例: ○○倉庫 引越し応援"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="日付">
              <DatePicker value={date} onChange={(d) => d && setDate(d)} />
            </Field>
            <Field label="状態">
              <CustomSelect
                size="sm"
                clearable={false}
                value={status}
                onChange={(v) => setStatus(v as SpotJobStatus)}
                options={(Object.keys(STATUS_LABEL) as SpotJobStatus[]).map((s) => ({
                  value: s,
                  label: STATUS_LABEL[s],
                }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="集合時刻">
              <TimePicker value={meetingTime} onChange={setMeetingTime} placeholder="--:--" />
            </Field>
            <Field label="終業時刻">
              <TimePicker value={endTime} onChange={setEndTime} placeholder="--:--" />
            </Field>
          </div>

          <Field label="集合場所">
            <input
              value={meetingPlace}
              onChange={(e) => setMeetingPlace(e.target.value)}
              className="w-full px-2 py-1.5 border border-slate-300 rounded"
              placeholder="例: ○○センター 北口"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="依頼元（任意）">
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded"
                placeholder="例: ○○運輸"
              />
            </Field>
            <Field label="請求額（参考・円）">
              <input
                type="number"
                min={0}
                value={billingAmount}
                onChange={(e) => setBillingAmount(e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-right"
                placeholder="未定"
              />
            </Field>
          </div>

          {/* 参加者 */}
          <div>
            <div className="block text-[11px] font-medium text-slate-500 mb-1">参加者</div>
            <div className="space-y-1.5">
              {members.map((m) => (
                <div key={m.key} className="flex items-center gap-1.5">
                  <div className="flex-1 min-w-0">
                    {m.type === "driver" ? (
                      <CustomSelect
                        size="sm"
                        clearable={false}
                        value={m.driverId || undefined}
                        onChange={(v) => setMember(m.key, { driverId: v })}
                        options={driverOptions}
                        placeholder="メンバーを選択"
                      />
                    ) : (
                      <input
                        value={m.displayName}
                        onChange={(e) => setMember(m.key, { displayName: e.target.value })}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded"
                        placeholder="名前（その日だけの人）"
                      />
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={m.payAmount}
                    onChange={(e) => setMember(m.key, { payAmount: e.target.value })}
                    className="w-24 px-2 py-1.5 border border-slate-300 rounded text-right"
                    placeholder="日当"
                    title="日当（参考・円）"
                  />
                  <button
                    onClick={() => removeMember(m.key)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 hover:text-red-600 hover:bg-red-50"
                    title="外す"
                  >
                    <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {members.length === 0 && <p className="text-xs text-slate-400">まだ参加者がいません。</p>}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px]">
              <button
                onClick={() =>
                  setMembers((prev) => [...prev, { key: nextKey(), type: "driver", driverId: "", displayName: "", payAmount: "" }])
                }
                className="text-slate-600 hover:text-slate-900"
              >
                <FontAwesomeIcon icon={faPlus} className="mr-1" />
                メンバー
              </button>
              <button
                onClick={() =>
                  setMembers((prev) => [...prev, { key: nextKey(), type: "name", driverId: "", displayName: "", payAmount: "" }])
                }
                className="text-slate-600 hover:text-slate-900"
              >
                <FontAwesomeIcon icon={faPlus} className="mr-1" />
                名前だけ
              </button>
            </div>
            {/* ゲスト登録: 繰り返し来る人を選択肢に昇格させる（名前だけで作成・ログイン不可） */}
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGuest()}
                className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs"
                placeholder="繰り返し来る人はゲスト登録（名前のみ）"
              />
              <button
                onClick={addGuest}
                disabled={guestBusy || !guestName.trim()}
                className="shrink-0 px-2.5 py-1.5 text-[11px] rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <FontAwesomeIcon icon={faUserPlus} className="mr-1 w-3 h-3" />
                ゲスト登録
              </button>
            </div>
          </div>

          <Field label="メモ（任意）">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 border border-slate-300 rounded resize-none"
              placeholder="持ち物・注意事項など"
            />
          </Field>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
