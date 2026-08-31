"use client";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/ui/utils";
import { activeLoan, courseIdsFor, createLoanDraft, linkedDriversFor, linkedVehicleId, loanOwner, money, shiftDailyRate, validateShift, vehicleFor, withCourse, type Loan, type Shift } from "./model";
import { DemoPlate, EditorModal, ErrorMessage, LeaseBadge, buttonClass, type PageProps } from "./ui";
import { MonthlyVehicleDialog } from "./MonthlyVehicleDialog";

// 実画面 shifts/page.tsx の editingCell / offModal / VehicleOptionList を土台にする。
// コースは＋追加・×解除、車両はプレート選択で即時反映。通信だけをローカル更新へ置換。
export function ShiftEditor({ demo, setDemo, notify, confirm, guard, setDirty, navigate, shift, onClose, dateLabel, initialLoanId }: Pick<PageProps, "demo" | "setDemo" | "notify" | "confirm" | "guard" | "setDirty" | "navigate"> & { shift: Shift; onClose: () => void; dateLabel: string; initialLoanId?: string }) {
  const [error, setError] = useState("");
  const [review, setReview] = useState<Loan | null>(() => demo.loans.find(loan => loan.id === initialLoanId && loan.date === shift.date && (loan.borrowerId === shift.driverId || loanOwner(demo, loan)?.id === shift.driverId)) ?? null);
  const driver = demo.drivers.find(d => d.id === shift.driverId)!;
  const assigned = courseIdsFor(shift);
  const borrowed = activeLoan(demo, driver.id, shift.date);
  const linkedVehicle = linkedVehicleId(driver, shift.date);
  const related = demo.loans.filter(l => l.date === shift.date && l.status !== "cancelled" && (l.borrowerId === driver.id || loanOwner(demo, l)?.id === driver.id));
  const selected = vehicleFor(demo, driver.id, shift.date);
  const finishReview = () => { setReview(null); setDirty(false); setError(""); };
  const commit = (candidate: Shift) => {
    const issue = validateShift(demo, candidate);
    if (issue) { setError(issue); return; }
    setDemo({ ...demo, shifts: demo.shifts.map(s => s.driverId === candidate.driverId && s.date === candidate.date ? candidate : s) });
    setError(""); notify("シフトをプレビュー内に反映しました");
  };
  const clearOff = () => confirm("希望休を解除しますか？", "全休を解除します。コースは解除後に追加できます。", () => commit({ ...shift, status: "empty", courseId: "", courseIds: [], vehicleId: "" }), "解除する");
  const vehicles = (linked: boolean) => demo.vehicles.filter(v => (v.id === linkedVehicle) === linked).map(vehicle => {
    const owners = linkedDriversFor(demo, vehicle.id, shift.date).filter(d => d.id !== driver.id);
    const used = demo.drivers.find(d => d.id !== driver.id && vehicleFor(demo, d.id, shift.date)?.id === vehicle.id);
    const isSelected = selected?.id === vehicle.id;
    const monthly = owners.length > 0 && linkedVehicle !== vehicle.id && !isSelected;
    const reason = borrowed && !isSelected ? "月額車を一時利用中" : vehicle.unavailable && !(borrowed && isSelected) ? "使用不可" : used ? `${used.name}が使用中` : "";
    const select = () => {
      if (borrowed && isSelected) { setReview({ ...borrowed }); return; }
      if (monthly) { setReview(createLoanDraft(demo, { date: shift.date, borrowerId: driver.id, vehicleId: vehicle.id })); return; }
      commit({ ...shift, vehicleId: vehicle.id });
    };
    return <button key={vehicle.id} aria-label={`${vehicle.plate}を配車`} aria-pressed={isSelected} disabled={!!reason} onClick={select} className={cn("relative flex w-full flex-col items-center gap-0.5 rounded-md p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400", isSelected ? "bg-slate-900/5 ring-2 ring-slate-900" : "hover:bg-slate-100", reason && !isSelected && "cursor-not-allowed opacity-45 grayscale")}>
      <DemoPlate vehicle={vehicle} className="pointer-events-none !max-w-none w-full"/>
      {isSelected && <span className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] text-white"><FontAwesomeIcon icon={faCheck}/></span>}
      <span className="text-[10px] leading-4 text-slate-500">{reason || (borrowed && isSelected ? "一時利用中・内容を確認" : monthly ? owners.length === 1 ? `${owners[0].name}の紐付け車両` : "複数人の紐付け車両" : isSelected ? "選択中" : vehicle.model)}</span>
    </button>;
  });
  if (review) return <MonthlyVehicleDialog key={review.id} demo={demo} setDemo={setDemo} notify={notify} setDirty={setDirty} guard={guard} confirm={confirm} loan={review} onClose={() => guard(finishReview)} onDone={finishReview}/>;
  return <EditorModal variant="shift" title={`${dateLabel}　${driver.name}`} onClose={onClose}>
    {shift.status === "off" ? <section className="space-y-3"><h3 className="text-sm font-semibold">{driver.name} の希望休</h3><div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"><span className="text-sm text-amber-900">全休</span><button className="min-h-11 px-3 text-xs font-medium text-red-600 hover:underline" onClick={clearOff}>解除</button></div></section> : <div className={cn("grid gap-4", assigned.length > 0 && "sm:grid-cols-2")}>
      <section className="min-w-0"><h3 className="mb-2 text-xs font-medium text-slate-600">コース</h3>
        <div className="space-y-2">{demo.courses.filter(c => assigned.includes(c.id)).map(course => <div key={course.id} className={cn("flex items-center justify-between gap-2 rounded-lg border pl-3 text-sm font-medium", course.color)}><span>{course.name}</span><button aria-label={`${course.name}を解除`} className="flex min-h-11 min-w-11 items-center justify-center rounded-r-lg hover:bg-black/5" onClick={() => commit(withCourse(shift, course.id, false))}><FontAwesomeIcon icon={faXmark}/></button></div>)}</div>
        {!assigned.length && <p className="mb-2 text-xs text-slate-400">コースが割り当てられていません。</p>}
        <div className="mt-3 space-y-2">{demo.courses.filter(c => !assigned.includes(c.id)).map(course => <div key={course.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 pl-3 text-sm text-slate-600"><span>{course.name}</span><button aria-label={`${course.name}を追加`} className="inline-flex min-h-11 shrink-0 items-center gap-1 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => commit(withCourse(shift, course.id, true))}><FontAwesomeIcon icon={faPlus}/>追加</button></div>)}</div>
      </section>
      {assigned.length > 0 && <section className="min-w-0"><h3 className="mb-2 text-xs font-medium text-slate-600">車両</h3>
        {driver.mode === "NONE" ? <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">持込車両（リースなし）</p> : <>
          <p className="mb-2 text-xs text-slate-600">使用車両：{selected?.plate ?? "車両なし"}</p>
          <button aria-pressed={!selected} disabled={!!borrowed} className={cn("mb-3 min-h-11 rounded-lg border px-3 text-xs disabled:opacity-40", !selected ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600")} onClick={() => commit({ ...shift, vehicleId: "" })}>車両なし</button>
          {linkedVehicle && <div className="mb-3"><p className="mb-2 text-[11px] text-slate-500">普段使う車両</p><div className="grid grid-cols-2 gap-2">{vehicles(true)}</div></div>}
          <p className="mb-2 text-[11px] text-slate-500">{linkedVehicle ? "その他の車両・代車" : "車両を選択"}</p><div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto p-1">{vehicles(false)}</div>
          {borrowed && <p className="mt-2 text-[11px] leading-5 text-amber-800">選択中のプレートから利用内容を確認・変更できます。</p>}
        </>}
      </section>}
    </div>}
    <ErrorMessage message={error}/>
    <section className="mt-4 space-y-2 border-t border-slate-200 pt-3" aria-label="リース連携">
      <div className="flex flex-wrap items-center justify-between gap-2"><LeaseBadge mode={driver.mode}/><button className="min-h-11 text-xs text-slate-600 underline underline-offset-4" onClick={() => navigate({ page: "drivers", driverId: driver.id, date: shift.date })}>ドライバーの契約設定</button></div>
      <p className="text-xs leading-5 text-slate-500">{driver.mode === "MONTHLY" ? `${money(driver.amount)} / 月・普段使う車両 ${demo.vehicles.find(v => v.id === linkedVehicle)?.plate ?? "未設定"}` : driver.mode === "DAILY" ? `通常日額 ${money(shiftDailyRate(demo, shift))} / 稼働日（予定に基づく参考表示）` : "リース料金なし"}</p>
      {related.map(loan => <button key={loan.id} className={buttonClass} onClick={() => setReview({ ...loan })}>{related.length === 1 ? "この日の利用内容" : `${loan.borrowerId === driver.id ? "借りる" : "貸し出す"}車両の利用内容`}</button>)}
    </section>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3"><p className="text-[11px] text-slate-400">操作ごとにプレビュー内へ反映</p><button onClick={onClose} className={buttonClass}>閉じる</button></div>
    {shift.status !== "off" && <button className="mt-2 min-h-11 text-[11px] text-slate-400 underline underline-offset-4" onClick={() => confirm("希望休のサンプルに変更しますか？", "プレビュー用の操作です。この日の全コースと配車を外し、全休にします。", () => commit({ ...shift, status: "off", courseId: "", courseIds: [], vehicleId: "" }), "希望休にする")}>プレビュー用：希望休を設定</button>}
  </EditorModal>;
}
