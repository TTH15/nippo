"use client";
import { useState } from "react";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { ParkingPlacesEditor } from "./ParkingPlacesEditor";
import { BEFORE_PICKUP_FUEL, RETURN_FUEL, loanBorrowerMode, loanDailyRate, loanFuelRecipientId, loanMonthlyAmount, loanNotifications, loanOwner, loanPickupTime, money, parkingPlaceDescription, updateLoan, validateLoan, type Demo, type Loan } from "./model";
import { Choice, DemoPlate, EditorModal, ErrorMessage, Field, buttonClass, inputClass, primaryClass, type PageProps } from "./ui";

function NotificationPreview({ demo, loan }: { demo: Demo; loan: Loan }) {
  return <div className="space-y-2">{loanNotifications(demo, loan).map(notification => <p key={notification.recipientId} className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">{notification.text}</p>)}</div>;
}

// ShiftEditorと同じ編集モーダルを使用。日付・利用者・車両は配車セルから引き継ぐ。
// 通知文を含めて画面内だけに保存し、本番のAPI・通知送信は呼ばない。
export function MonthlyVehicleDialog({ demo, setDemo, notify, setDirty, guard, confirm, loan, onClose, onDone }: Pick<PageProps, "demo" | "setDemo" | "notify" | "setDirty" | "guard" | "confirm"> & { loan: Loan; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<Loan>({ ...loan, ownerId: loanOwner(demo, loan)?.id ?? "", pickupTime: loanPickupTime(loan), fuelRecipientId: loanFuelRecipientId(demo, loan) });
  const [withFuel, setWithFuel] = useState(!!loan.fuel);
  const [withNote, setWithNote] = useState(!!loan.note);
  const [showMessage, setShowMessage] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [error, setError] = useState("");
  const existing = demo.loans.find(item => item.id === loan.id);
  const readOnly = !!existing && existing.status !== "planned";
  const owner = loanOwner(demo, draft);
  const borrower = demo.drivers.find(driver => driver.id === draft.borrowerId);
  const vehicle = demo.vehicles.find(item => item.id === draft.vehicleId);
  const content = { ...draft, fuel: withFuel ? draft.fuel.trim() : "", fuelRecipientId: withFuel ? draft.fuelRecipientId : undefined, note: withNote ? draft.note.trim() : "" };
  const recipientOptions = [owner, borrower, ...demo.drivers.filter(driver => driver.id !== borrower?.id && driver.id !== owner?.id)].flatMap(driver => driver ? [{ value: driver.id, label: driver.name, description: driver.id === borrower?.id ? "利用者" : driver.id === owner?.id ? "貸し出す人" : undefined }] : []);
  const placeOptions = [{ value: "", label: "駐車場所を選択" }, ...demo.parkingPlaces.map(place => ({ value: place.id, label: place.name, description: parkingPlaceDescription(place) || undefined }))];
  const change = (patch: Partial<Loan>) => { setDraft(previous => ({ ...previous, ...patch })); setFormDirty(true); setDirty(true); setError(""); };
  const apply = (next: Loan, message: string) => {
    const result = updateLoan(demo, next);
    setDemo(result.demo); setFormDirty(false); setDirty(false); onDone();
    notify(message + (result.releasedWithoutVehicle.length ? " 元の車両は他の人が使用中のため、元の利用者を未配車にしました。" : ""));
  };
  const save = () => {
    if (withFuel && !content.fuel) { setError("通知する給油の内容を入力してください。"); return; }
    if (withNote && !content.note) { setError("通知する移動・受け渡しの内容を入力してください。"); return; }
    // この確認モーダルの確定操作を、受け渡しと次回利用の確認として記録する。
    const candidate = { ...content, checked: true };
    const issue = validateLoan(demo, candidate);
    if (issue) { setError(issue); return; }
    apply(candidate, existing ? "利用内容を保存しました。通知は送信していません" : "月額車を配車しました。通知は送信していません");
  };
  const changeStatus = (status: "returned" | "cancelled") => {
    if (!existing) return;
    guard(() => {
      setDraft({ ...existing, fuelRecipientId: loanFuelRecipientId(demo, existing) }); setWithFuel(!!existing.fuel); setWithNote(!!existing.note); setFormDirty(false); setDirty(false); setError("");
      confirm(status === "cancelled" ? "月額車の一時利用を取り消しますか？" : "返却済みにしますか？", status === "cancelled" ? "元の配車に戻します。元の車両が使用中なら未配車にします。月額契約・料金は変わりません。" : "プレビュー内の記録だけを変更します。この日の車両利用の記録は残ります。", () => apply({ ...existing, status }, status === "cancelled" ? "一時利用を取り消しました。通知は送信していません" : "返却済みにしました。通知は送信していません"), status === "cancelled" ? "一時利用を取り消す" : "返却済みにする");
    });
  };
  if (placesOpen) return <ParkingPlacesEditor demo={demo} setDemo={setDemo} notify={notify} confirm={confirm} selectedIds={[draft.pickupPlaceId, draft.returnPlaceId]} onDirtyChange={dirty => setDirty(formDirty || dirty)} onClose={() => { setPlacesOpen(false); setDirty(formDirty); }}/>;
  return <EditorModal variant="shift" title={existing ? "月額車の利用内容" : "月額リース車両の配車"} onClose={onClose} footer={<>
    <div className="flex flex-wrap gap-2">{!readOnly && <button className={primaryClass} onClick={save}>{existing ? "確認して内容を保存" : "確認して配車"}</button>}<button className={buttonClass} onClick={onClose}>{readOnly ? "戻る" : "キャンセル"}</button></div>
    <p className="mt-2 text-[11px] text-slate-400">プレビュー内の保存のみ。外部通知・請求確定は行いません。</p>
  </>}>
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-950">{owner ? `${owner.name}さんから車両を借ります。` : "貸し出す人を選択してください。"}</p>
        <div className="mt-2 flex items-center gap-3">{vehicle && <DemoPlate vehicle={vehicle} className="w-24 shrink-0"/>}<div className="min-w-0 text-xs leading-5 text-amber-900"><p>{draft.date.replaceAll("-", "/")}</p><p>{borrower?.name}さんに配車</p></div></div>
        <p className="mt-2 text-[11px] leading-5 text-amber-900">{loanBorrowerMode(demo, draft) === "MONTHLY" ? `利用者は月額リース ${money(draft.borrowerMonthlyAmount ?? borrower?.amount ?? 0)}。代車の追加料金・精算は別途確認。` : `利用者は通常日額 ${money(loanDailyRate(demo, draft))}（参考）。`}{owner?.mode === "MONTHLY" && ` 貸出側の月額 ${money(loanMonthlyAmount(demo, draft))}は据え置き。`}</p>
      </div>
      {readOnly ? <div><p className="mb-2 text-sm font-medium">{existing.status === "cancelled" ? "取消済み" : "返却済み"}</p>{existing.status === "cancelled" ? <p className="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">この利用は取り消されています。給油・移動の指示は無効です。</p> : <NotificationPreview demo={demo} loan={existing}/>}</div> : <>
        <section className="space-y-3" aria-label="通知内容">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">通知内容</h3><button type="button" className="min-h-11 text-xs text-slate-500 underline underline-offset-4" onClick={() => setPlacesOpen(true)}>駐車場所を編集</button></div>
          <Field label="貸し出す人"><Choice label="貸し出す人" value={draft.ownerId ?? ""} onChange={ownerId => change({ ownerId, monthlyAmount: undefined, fuelRecipientId: draft.fuelRecipientId === draft.ownerId || !draft.fuelRecipientId ? ownerId : draft.fuelRecipientId })} options={[{ value: "", label: "貸し出す人を選択" }, ...demo.drivers.filter(driver => driver.id !== draft.borrowerId).map(driver => ({ value: driver.id, label: driver.name }))]}/></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="受取場所"><Choice label="受取場所" value={draft.pickupPlaceId} onChange={pickupPlaceId => change({ pickupPlaceId })} options={placeOptions}/></Field>
            <Field label="返却場所"><Choice label="返却場所" value={draft.returnPlaceId} onChange={returnPlaceId => change({ returnPlaceId })} options={placeOptions}/></Field>
          </div>
          {!demo.parkingPlaces.length && <p className="text-xs leading-5 text-amber-800">駐車場所が未登録です。「駐車場所を編集」から登録してください。</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="受取時刻"><input aria-label="受取時刻" type="time" value={draft.pickupTime ?? ""} onInput={event => change({ pickupTime: event.currentTarget.value })} onChange={event => change({ pickupTime: event.target.value })} className={inputClass}/></Field>
            <Field label="返却時刻"><input aria-label="返却時刻" type="time" value={draft.returnTime} onInput={event => change({ returnTime: event.currentTarget.value })} onChange={event => change({ returnTime: event.target.value })} className={inputClass}/></Field>
          </div>
          <p className="text-xs leading-5 text-slate-500">貸し出す人へ、受取時刻までに受取場所へ駐車するよう通知します。</p>
          <p className="text-xs leading-5 text-slate-500">利用者の返却時：{RETURN_FUEL}</p>
          <div><CheckboxField label="貸出前の満タン給油を依頼する" checked={withFuel} onCheckedChange={checked => { setWithFuel(checked); change({ fuel: draft.fuel || BEFORE_PICKUP_FUEL }); }}/><SmoothCollapse open={withFuel}><div className="mt-2 space-y-3">
            <Field label="依頼する相手"><Choice label="給油の依頼先" value={loanFuelRecipientId(demo, draft)} onChange={fuelRecipientId => change({ fuelRecipientId })} options={recipientOptions}/></Field>
            <Field label="依頼する内容"><input aria-label="給油の指示" placeholder={BEFORE_PICKUP_FUEL} value={draft.fuel} onChange={event => change({ fuel: event.target.value })} className={inputClass}/></Field>
          </div></SmoothCollapse></div>
          <div><CheckboxField label="移動・受け渡しの連絡を加える" checked={withNote} onCheckedChange={checked => { setWithNote(checked); change({}); }}/><SmoothCollapse open={withNote}><textarea aria-label="移動・受け渡しの連絡" placeholder="例：返却後、鍵を車庫の指定ボックスへ" value={draft.note} onChange={event => change({ note: event.target.value })} className={inputClass + " mt-2 h-20 py-2"}/></SmoothCollapse></div>
        </section>
        <div><button type="button" aria-expanded={showMessage} aria-controls="monthly-car-message" className="min-h-11 text-xs text-slate-500 underline underline-offset-4" onClick={() => setShowMessage(open => !open)}>通知文を見る</button><SmoothCollapse open={showMessage} id="monthly-car-message"><NotificationPreview demo={demo} loan={content}/></SmoothCollapse></div>
        <ErrorMessage message={error}/>
        <p className="text-xs leading-5 text-slate-600">受け渡しと次回利用に無理がないことを確認して確定してください。</p>
      </>}
      {existing?.status === "planned" && <div className="flex flex-wrap items-center justify-between gap-2"><button className="min-h-11 text-xs text-slate-500 underline underline-offset-4" onClick={() => changeStatus("returned")}>返却済みにする</button><button className="min-h-11 text-xs text-red-600 underline underline-offset-4" onClick={() => changeStatus("cancelled")}>一時利用を取り消す</button></div>}
    </div>
  </EditorModal>;
}
