"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faBell, faTruck, faCheck } from "@fortawesome/free-solid-svg-icons";
import { EditorModal } from "@/lib/components/EditorModal";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { DatePicker } from "@/lib/components/DatePicker";
import { TimePicker } from "@/lib/ui/time-picker";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { buttonClass, primaryClass, inputClass, Field } from "../driver-leases/ui";
import { cancelMove, markArrived, messages, notificationAt, people, personName, places, placeName, previewNow, runNotice, sampleUses, sampleVehicle, saveMove, stamp, suggestMoves, type Move } from "./model";

const stateNames = { needed: "未手配", planned: "手配済み", arrived: "到着済み", cancelled: "取消" };
const noticeNames = { none: "通知なし", scheduled: "通知予約あり", sent: "送信済み（確認用）", failed: "通知失敗（確認用）" };
const dateValue = (value: string) => new Date(`${value}T12:00:00`);
const dateString = (value: Date | undefined) => value ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : "";

function PlaceSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <CustomSelect ariaLabel={label} size="md" value={value} onChange={onChange} options={places.map(place => ({ value: place.id, label: place.name }))} />;
}
function PersonSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <CustomSelect ariaLabel={label} size="md" value={value} onChange={onChange} placeholder="担当者を選択" options={people.map(person => ({ value: person.id, label: person.name }))} />;
}
function DateTime({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [day, time] = value.split("T");
  return <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2" aria-label={label}>
    <DatePicker ariaLabel={`${label}の日付`} value={day ? dateValue(day) : undefined} onChange={date => onChange(`${dateString(date)}T${time || "00:00"}`)} displayFormat="M月d日（E）" />
    <TimePicker value={time} onChange={next => onChange(`${day}T${next ?? ""}`)} clearable={false} buttonClassName="h-11 w-full" />
  </div>;
}

// 本番のシフトページを描画するstandalone版からだけ使用する。配車・通知の本番接続はまだ行わない。
// 旧MonthlyVehicleDialogの通知確認を土台に、共通EditorModal・車両・選択・日時部品を再利用。
export function VehicleHandoffsPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [moves, setMoves] = useState(() => suggestMoves(sampleUses));
  const [draft, setDraft] = useState<Move | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [showMessage, setShowMessage] = useState(false);
  const [filter, setFilter] = useState("active");
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; action: () => void } | null>(null);
  const [arrival, setArrival] = useState<{ move: Move; placeId: string; at: string } | null>(null);
  const [now, setNow] = useState(previewNow);
  const [notice, setNotice] = useState("");
  const [failSave, setFailSave] = useState(false);
  const [failNotice, setFailNotice] = useState(false);

  const replace = (next: Move) => setMoves(previous => previous.map(move => move.id === next.id ? next : move));
  const guard = (action: () => void) => dirty ? setConfirm({ title: "入力を破棄しますか？", message: "保存していない変更があります。", label: "破棄する", action }) : action();
  const closeEditor = () => guard(() => { setDraft(null); setDirty(false); setError(""); });
  const closeArrival = () => guard(() => { setArrival(null); setDirty(false); setError(""); });
  const closePanel = onClose;
  const openEditor = (move: Move) => { setDraft({ ...move }); setDirty(false); setError(""); setShowMessage(false); };
  const change = (patch: Partial<Move>) => { setDraft(previous => previous ? { ...previous, ...patch } : null); setDirty(true); setError(""); };
  const save = () => {
    if (!draft) return;
    try {
      const next = saveMove(draft, moves.find(move => move.id === draft.id)!, now);
      if (failSave) { setFailSave(false); throw new Error("保存できませんでした。入力は残っています。もう一度お試しください。"); }
      replace(next); setDraft(null); setDirty(false); setError(""); setNotice("手配を保存しました。");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "保存できませんでした。"); }
  };
  const cancel = (move: Move) => setConfirm({ title: "移動の手配を取り消しますか？", message: move.sentRevision ? "配車はそのまま残ります。連絡済みの相手への取消通知も予約します。" : "配車はそのまま残ります。予約していた通知も取り消します。", label: "手配を取り消す", action: () => { replace(cancelMove(move, now)); setDraft(null); setDirty(false); setNotice("手配を取り消しました。"); } });
  const simulateNotices = () => {
    const nextTime = moves.filter(move => move.notice === "scheduled").map(move => move.scheduledAt!).sort()[0];
    if (!nextTime) { setNotice("予約中の通知はありません。"); return; }
    setNow(nextTime > now ? nextTime : now);
    setMoves(previous => previous.map(move => runNotice(move, nextTime > now ? nextTime : now, failNotice)));
    setFailNotice(false); setNotice("通知の動作を確認しました。実際には送信していません。");
  };
  const finishArrival = () => {
    if (!arrival) return;
    try { const next = markArrived(arrival.move, arrival.placeId, arrival.at); replace(next); setNow(previous => arrival.at > previous ? arrival.at : previous); setArrival(null); setDirty(false); setError(""); setNotice(next.state === "arrived" ? "完了を記録しました。" : "到着場所を記録しました。届け先への移動は未完了です。"); }
    catch (issue) { setError((issue as Error).message); }
  };
  const displayed = moves.filter(move => filter === "all" || (filter === "active" ? move.state !== "arrived" && move.state !== "cancelled" : move.state === "arrived"));
  const actual = [...moves].filter(move => move.arrivedAt).sort((a, b) => b.arrivedAt!.localeCompare(a.arrivedAt!))[0];
  const selected = draft ? moves.find(move => move.id === draft.id) : undefined;
  const readOnly = draft?.state === "arrived" || draft?.state === "cancelled";
  const isTransfer = draft?.fromPlaceId !== draft?.toPlaceId;
  if (!open) return null;

  return <>
    <EditorModal variant="shift" title={arrival ? "完了を記録" : draft ? isTransfer ? "車両移動の手配" : "受け渡しの手配" : "車両移動・受け渡し"}
      onClose={arrival ? closeArrival : draft ? closeEditor : closePanel}
      footer={arrival ? <div className="flex gap-2"><button className={primaryClass} onClick={finishArrival}>完了を記録</button><button className={buttonClass} onClick={closeArrival}>戻る</button></div>
        : draft ? <div className="flex flex-wrap gap-2">{!readOnly && <button className={primaryClass} onClick={save}>{draft.notifyMode === "none" ? "手配を保存" : "保存して通知を予約"}</button>}<button className={buttonClass} onClick={closeEditor}>戻る</button></div>
        : <button className={buttonClass + " w-full"} onClick={closePanel}>シフト表に戻る</button>}>
      <p className="mb-4 text-xs text-slate-500">確認用の画面です。実際の保存・通知は行いません。</p>
      {arrival ? <div className="space-y-4">
        <p className="text-sm">車両1201を、実際にどこへ届けましたか？</p>
        <Field label="到着場所"><PlaceSelect label="到着場所" value={arrival.placeId} onChange={placeId => { setArrival({ ...arrival, placeId }); setDirty(true); }}/></Field>
        <Field label="到着日時"><DateTime label="到着日時" value={arrival.at} onChange={at => { setArrival({ ...arrival, at }); setDirty(true); }}/></Field>
      </div> : draft ? <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3"><VehiclePlate vehicle={sampleVehicle} compact className="w-24 shrink-0"/><div className="text-xs leading-6"><p>{stamp(draft.to.date)}の利用：{personName(draft.to.driverId)}</p><p>普段使う人：佐藤（月額）</p></div></div>
        <div className="grid grid-cols-2 gap-3 text-xs leading-5"><p className="rounded-lg border border-slate-200 p-3">前の仕事<br/><strong>{stamp(draft.from.date)} {personName(draft.from.driverId)}</strong><br/>{placeName(draft.from.placeId)} · {draft.from.end}終了</p><p className="rounded-lg border border-slate-200 p-3">次の仕事<br/><strong>{stamp(draft.to.date)} {personName(draft.to.driverId)}</strong><br/>{placeName(draft.to.placeId)} · {draft.to.start}開始</p></div>
        {readOnly ? <p className="text-sm font-semibold">{stateNames[draft.state]}</p> : <>
          <div className="grid grid-cols-2 gap-3"><Field label="出発地"><PlaceSelect label="出発地" value={draft.fromPlaceId} onChange={fromPlaceId => change({ fromPlaceId })}/></Field><Field label="届け先"><PlaceSelect label="届け先" value={draft.toPlaceId} onChange={toPlaceId => change({ toPlaceId })}/></Field></div>
          <Field label={isTransfer ? "運ぶ人" : "受け渡す人"}><PersonSelect label={isTransfer ? "運ぶ人" : "受け渡す人"} value={draft.assigneeId} onChange={assigneeId => change({ assigneeId })}/></Field>
          <Field label={isTransfer ? "いつまでに届ける" : "受け渡す日時"}><DateTime label="届ける期限" value={draft.dueAt} onChange={dueAt => change({ dueAt })}/></Field>
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <Field label="いつ通知する"><CustomSelect ariaLabel="通知する日" size="md" value={draft.notifyMode} clearable={false} onChange={value => change({ notifyMode: value as Move["notifyMode"] })} options={[{ value: "previous_day", label: "次の利用日の前日" }, { value: "specified", label: "日時を指定" }, { value: "none", label: "通知しない" }]}/></Field>
            <SmoothCollapse open={draft.notifyMode !== "none"}><div className="space-y-2">{draft.notifyMode === "previous_day" ? <Field label="通知時刻"><TimePicker value={draft.notifyTime} onChange={value => change({ notifyTime: value ?? "" })} clearable={false} buttonClassName="h-11 w-full"/></Field> : <DateTime label="通知日時" value={`${draft.notifyDate}T${draft.notifyTime}`} onChange={value => { const [notifyDate, notifyTime] = value.split("T"); change({ notifyDate, notifyTime }); }}/>}<p className="text-xs text-slate-600"><FontAwesomeIcon icon={faBell} className="mr-1.5"/>{stamp(notificationAt(draft) ?? "")}に通知</p></div></SmoothCollapse>
          </div>
          <CheckboxField label="引き渡し前の満タン給油を依頼する" checked={draft.fuel} onCheckedChange={fuel => change({ fuel })}/>
          <SmoothCollapse open={draft.fuel}><Field label="給油する人"><PersonSelect label="給油する人" value={draft.fuelPersonId} onChange={fuelPersonId => change({ fuelPersonId })}/></Field></SmoothCollapse>
          <Field label="鍵・駐車場所の連絡"><textarea aria-label="鍵・駐車場所の連絡" className={inputClass + " h-20 py-2"} placeholder="例：鍵は車庫のボックスへ" value={draft.note} onChange={event => change({ note: event.target.value })}/></Field>
        </>}
        <button className="min-h-11 text-sm text-slate-600 underline underline-offset-4" aria-expanded={showMessage} onClick={() => setShowMessage(value => !value)}>相手に届く内容を見る</button>
        <SmoothCollapse open={showMessage}><div className="space-y-2">{messages(draft).map(message => <div key={message.personId} className="rounded-lg bg-slate-50 p-3"><p className="mb-1 text-xs font-semibold">{personName(message.personId)}さんへ</p><p className="whitespace-pre-line text-xs leading-6 text-slate-700">{message.text}</p></div>)}</div></SmoothCollapse>
        {selected?.state === "planned" && <button className="min-h-11 text-sm text-red-600 underline" onClick={() => cancel(selected)}>移動の手配を取り消す</button>}
      </div> : <div className="space-y-4">
        <div className="flex items-center gap-3"><VehiclePlate vehicle={sampleVehicle} compact className="w-24 shrink-0"/><div className="text-xs leading-6"><p>佐藤の月額車 → 田中の日額利用</p><p>最後の到着記録：<strong>{actual ? `${placeName(actual.actualPlaceId!)} ${stamp(actual.arrivedAt!)}` : "未記録"}</strong></p></div></div>
        <div className="flex gap-2" aria-label="移動の絞り込み">{[{ value: "active", label: "未完了" }, { value: "arrived", label: "完了" }, { value: "all", label: "すべて" }].map(option => <button key={option.value} onClick={() => setFilter(option.value)} aria-pressed={filter === option.value} className={filter === option.value ? primaryClass : buttonClass}>{option.label}</button>)}</div>
        {!displayed.length && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">該当する移動はありません。</p>}
        {displayed.map(move => <section key={move.id} aria-label={`${stamp(move.from.date)}から${stamp(move.to.date)}の移動`} className="space-y-3 rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">{stamp(move.from.date)} {personName(move.from.driverId)} → {stamp(move.to.date)} {personName(move.to.driverId)}</p><span className={`rounded px-2 py-1 text-xs font-semibold ${move.state === "needed" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{stateNames[move.state]}</span></div>
          <p className="flex items-center gap-2 text-sm font-semibold"><span>{placeName(move.fromPlaceId)}</span>{move.fromPlaceId === move.toPlaceId ? <span>で受け渡し</span> : <><FontAwesomeIcon icon={faArrowRight} className="text-slate-400"/><span>{placeName(move.toPlaceId)}</span></>}</p>
          <p className="text-xs text-slate-600">{stamp(move.dueAt)}まで · 担当：{personName(move.assigneeId)}</p>
          {move.state !== "needed" && <p className="text-xs text-slate-500"><FontAwesomeIcon icon={faBell} className="mr-1.5"/>{noticeNames[move.notice]}{move.notice === "scheduled" && ` · ${stamp(move.scheduledAt!)}`}</p>}
          {move.arrivedAt && <p className="text-xs text-slate-600">到着：{placeName(move.actualPlaceId!)} · {stamp(move.arrivedAt)}</p>}
          <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => openEditor(move)}><FontAwesomeIcon icon={faTruck}/>{move.state === "needed" ? move.fromPlaceId === move.toPlaceId ? "受け渡しを手配" : "移動を手配" : "内容を見る"}</button>{move.state === "planned" && <button className={primaryClass} onClick={() => { setArrival({ move, placeId: move.toPlaceId, at: move.dueAt }); setError(""); }}><FontAwesomeIcon icon={faCheck}/>完了を記録</button>}{move.notice === "failed" && <button className={buttonClass} onClick={() => replace({ ...move, notice: "scheduled", scheduledAt: now })}>通知を再予約</button>}</div>
        </section>)}
        <div className="space-y-2 border-t border-dashed border-slate-200 pt-4"><p className="text-xs text-slate-400">動作確認 · {stamp(now)}</p><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={simulateNotices}>通知時刻まで進める</button><button className={buttonClass} onClick={() => { setFailSave(true); setNotice("次の保存失敗を試せます。"); }}>保存失敗を試す</button><button className={buttonClass} onClick={() => { setFailNotice(true); setNotice("次の通知失敗を試せます。"); }}>通知失敗を試す</button></div></div>
        {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
      </div>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </EditorModal>
    {confirm && <ConfirmDialog open title={confirm.title} message={confirm.message} confirmLabel={confirm.label} onConfirm={() => { confirm.action(); setConfirm(null); }} onClose={() => setConfirm(null)}/>}
  </>;
}
