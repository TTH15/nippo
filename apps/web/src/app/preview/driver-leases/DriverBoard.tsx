"use client";
import { useRef, useState } from "react";
import { format } from "date-fns";
import { SaveFailureNotice } from "@/lib/components/SaveFailureNotice";
import { saveDriverSections, type DriverSaveTask } from "@/lib/drivers/saveSections";
import { DatePicker } from "@/lib/components/DatePicker";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen, faPlus, faTag, faTrashCan, faMagnifyingGlass, faUser } from "@fortawesome/free-solid-svg-icons";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { DATES, MODE_NAMES, filterDrivers, linkedVehicleId, loanOwner, shiftFor, money, updateDriver, validateDriver, type Driver, type LeaseMode } from "./model";
import { VehicleLinksField } from "./VehicleLinksField";
import { Choice, EditorModal, Empty, ErrorMessage, Field, Labels, LeaseBadge, buttonClass, inputClass, primaryClass, type PageProps } from "./ui";

export function DriverBoard({ demo, setDemo, notify, setDirty, guard, confirm, navigate, target }: PageProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [mode, setMode] = useState("all");
  const [editing, setEditing] = useState<Driver | null>(() => {
    const driver = demo.drivers.find(d => d.id === target.driverId);
    return driver ? { ...driver, vehicleId: linkedVehicleId(driver, target.date ?? "2026-09-07"), labels: [...driver.labels] } : null;
  });
  const [linkDate, setLinkDate] = useState(target.date ?? "2026-09-07");
  const [shiftDate, setShiftDate] = useState(target.date ?? "2026-09-07");
  const [error, setError] = useState("");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [failNextLease, setFailNextLease] = useState(!!target.repairSave);
  const [saving, setSaving] = useState(false);
  const profileSaved = useRef(false);
  const change = (patch: Partial<Driver>) => { if ("labels" in patch || "vehicleId" in patch) profileSaved.current = false; setEditing(d => d && ({ ...d, ...patch })); setError(""); setDirty(true); };
  const close = () => guard(() => { setEditing(null); setDirty(false); });
  const save = async (showShift = false) => {
    if (!editing) return;
    const issue = validateDriver(demo, editing, linkDate);
    if (issue) { setError(issue); return; }
    if (target.repairSave) {
      setSaving(true);
      const tasks: DriverSaveTask[] = [];
      let next = demo;
      if (!profileSaved.current) tasks.push({ section: "profile", save: async () => {}, onSaved: () => {
        profileSaved.current = true;
        const original = next.drivers.find(d => d.id === editing.id)!;
        next = updateDriver(next, { ...editing, mode: original.mode, amount: original.amount }, linkDate);
        setDemo(next);
      }});
      tasks.push({ section: "lease", save: async () => {
        if (failNextLease) { setFailNextLease(false); throw new Error("保存処理に失敗しました（プレビューで再現）。"); }
      }, onSaved: () => { next = { ...next, drivers: next.drivers.map(d => d.id === editing.id ? { ...d, mode: editing.mode, amount: editing.amount } : d) }; setDemo(next); } });
      try { await saveDriverSections(tasks); }
      catch (issue) { setError(issue instanceof Error ? issue.message : "保存に失敗しました。"); return; }
      finally { setSaving(false); }
    } else {
      setDemo(updateDriver(demo, editing, linkDate));
    }
    setDirty(false); setEditing(null); notify("ドライバー情報を保存しました。シフトの表示にも反映されます");
    if (showShift) navigate({ page: "shifts", driverId: editing.id, date: shiftDate }, true);
  };
  const savedDriver = demo.drivers.find(d => d.id === editing?.id);
  const linkedLoans = savedDriver ? demo.loans.filter(l => l.status !== "cancelled" && (l.borrowerId === savedDriver.id || loanOwner(demo, l)?.id === savedDriver.id)) : [];
  const editor = editing && <EditorModal title={`No.${editing.no}　${editing.name}`} onClose={close}>
    <div className="space-y-4"><Field label="ラベル（複数選択）"><div className="grid gap-2 sm:grid-cols-2">{demo.labels.map(l => <CheckboxField key={l.id} label={l.name} variant="row" checked={editing.labels.includes(l.id)} onCheckedChange={checked => change({ labels: checked ? [...editing.labels, l.id] : editing.labels.filter(id => id !== l.id) })}/>)}</div></Field><div className="border-t border-slate-100 pt-4"><Field label="リース区分"><Choice label="リース区分" value={editing.mode} onChange={mode => change({ mode: mode as LeaseMode, amount: mode === "MONTHLY" ? editing.amount || 35000 : 0 })} options={Object.entries(MODE_NAMES).map(([value, label]) => ({ value, label }))}/></Field></div>
      <SmoothCollapse open={editing.mode === "MONTHLY"}><Field label="月額料金（円）"><input aria-label="月額料金" className={inputClass} type="number" min="1" step="1" value={editing.amount || ""} onChange={e => change({ amount: Number(e.target.value) })}/></Field></SmoothCollapse>
      {editing.mode === "DAILY" && <p className="rounded-lg bg-amber-50 p-4 text-sm leading-6 text-amber-800">稼働日に使用したコースの日額料金を適用します。<span className="mt-1 block text-xs">サンプル料金：Amazon ¥1,800 / ヤマト ¥1,500</span></p>}
      {editing.mode === "NONE" && <p className="text-sm text-slate-500">リース料金は発生しません。</p>}
      {savedDriver && <VehicleLinksField demo={demo} driver={savedDriver} date={linkDate} vehicleId={editing.vehicleId} onDateChange={date => { setLinkDate(date); setShiftDate(date); change({ vehicleId: linkedVehicleId(savedDriver, date) }); }} onVehicleChange={vehicleId => change({ vehicleId })}/>}
      <div className="space-y-3 border-t border-slate-100 pt-4"><Field label="確認するシフト日"><DatePicker className="min-h-11 w-full" ariaLabel="確認するシフト日" value={new Date(shiftDate + "T12:00:00")} fromDate={new Date(DATES[0] + "T12:00:00")} toDate={new Date(DATES[DATES.length - 1] + "T12:00:00")} onChange={date => date && setShiftDate(format(date, "yyyy-MM-dd"))}/></Field>
        {linkedLoans.length > 0 && <div><p className="mb-2 text-xs font-medium text-slate-600">関連する一時貸出</p><div className="flex flex-wrap gap-2">{linkedLoans.map(loan => <button key={loan.id} className={buttonClass + " text-xs"} onClick={() => navigate({ page: "shifts", driverId: editing.id, date: loan.date, loanId: loan.id })}>{loan.date} · {loan.status === "returned" ? "返却済み" : "貸出予定"}を確認</button>)}</div></div>}
      </div>
      {target.repairSave && <div className="rounded-lg border border-slate-200 p-3"><CheckboxField label="次の契約保存を失敗させる（プレビュー）" checked={failNextLease} onCheckedChange={setFailNextLease}/><p className="mt-2 text-xs text-slate-500">{profileSaved.current ? "ラベル・車両紐付けは保存済みです。未保存の契約だけ再試行します。" : "ラベル・車両紐付けと契約を別々に保存する失敗ケースです。"}</p></div>}
      {target.repairSave ? <SaveFailureNotice message={error} busy={saving} onRetry={() => void save()}/> : <ErrorMessage message={error}/>}<div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5"><button disabled={saving} className={primaryClass} onClick={() => void save()}>ドライバー情報を保存</button><button disabled={saving} className={buttonClass} onClick={() => void save(true)}>保存してシフトを確認</button><button className={buttonClass} onClick={close}>キャンセル</button></div><p className="text-[11px] leading-5 text-slate-400">紐付けの変更は指定日以降に反映し、過去の紐付けと既存の配車は残ります。当日の車両はシフトで変更できます。料金の契約履歴・精算は対象外です。</p></div>
  </EditorModal>;
  const drivers = status === "active" ? filterDrivers(demo, "all", mode, query) : [];
  const open = (d: Driver) => { const date = target.date ?? "2026-09-07"; setLinkDate(date); setShiftDate(date); setEditing({ ...d, vehicleId: linkedVehicleId(d, date), labels: [...d.labels] }); setError(""); profileSaved.current = false; setDirty(false); };
  const courseOf = (d: Driver) => demo.courses.find(c => c.id === shiftFor(demo, d.id, "2026-09-01")?.courseId);
  return <div className="w-full">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold text-slate-900">ドライバー管理</h1><p className="mt-0.5 text-sm text-slate-500">会社コード: PREVIEW<span className="hidden text-slate-400 md:inline"> · 並び順: No.（昇順）、同値時は名前順</span></p></div><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => setLabelsOpen(true)}><FontAwesomeIcon icon={faTag}/>ラベルを編集</button><button className={primaryClass} onClick={() => notify("新規追加は配置確認用です。既存の架空ドライバーを選んでラベル・契約を編集してください")}><FontAwesomeIcon icon={faPlus}/>新規追加</button></div></div>
    <div className="mb-4 flex flex-wrap items-center gap-2"><div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">{[["active", "稼働中"], ["inactive", "稼働終了"]].map(([id, name]) => <button key={id} aria-pressed={status === id} onClick={() => setStatus(id)} className={`rounded-md px-4 py-1.5 text-sm ${status === id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500"}`}>{name}</button>)}</div><div className="flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 shadow-sm sm:w-64"><FontAwesomeIcon icon={faMagnifyingGlass} className="h-3.5 w-3.5 shrink-0 text-slate-400"/><input aria-label="ドライバーを検索" placeholder="名前で検索" value={query} onChange={e => setQuery(e.target.value)} className="w-full bg-transparent text-xs outline-none"/></div><div className="flex flex-wrap gap-1.5">{[["all", "すべて"], ...Object.entries(MODE_NAMES)].map(([id, name]) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)} className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium ${mode === id ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{name}<span className="opacity-60">{demo.drivers.filter(d => id === "all" || d.mode === id).length}</span></button>)}</div></div>
    {!drivers.length ? <Empty>{status === "inactive" ? "稼働終了のモックデータはありません。" : "該当するドライバーがいません。"}</Empty> : <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* users/page.tsx の名簿テーブルを複製し、ラベル・リースの列を追加。 */}
      <div className="hidden overflow-x-auto table-scroll table-scroll-fade md:block"><table className="w-full min-w-[1180px] text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{["No.", "ドライバー", "ドライバーコード", "表示名", "コース", "ラベル", "リース契約", "免許期限", "権限"].map(name => <th key={name} className="whitespace-nowrap px-4 py-3 text-left font-semibold">{name}</th>)}</tr></thead><tbody>{drivers.map(d => <tr key={d.id} onClick={() => open(d)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"><td className="px-4 py-3 text-xs tabular-nums text-slate-400">{d.no}</td><td className="px-4 py-3"><button aria-label={`${d.name}のラベル・契約を編集`} className="flex items-center gap-2.5 text-left"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><FontAwesomeIcon icon={faUser} className="h-4 w-4"/></span><span className="whitespace-nowrap font-semibold text-slate-900">{d.name}</span></button></td><td className="whitespace-nowrap px-4 py-3 font-mono text-xs tracking-wide text-slate-500">DEMO{String(d.no).padStart(4, "0")}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{d.name.split(" ")[0]}</td><td className="px-4 py-3"><span className={`whitespace-nowrap rounded border px-2 py-1 text-xs ${courseOf(d)?.color}`}>{courseOf(d)?.name}</span></td><td className="min-w-[130px] px-4 py-3"><Labels demo={demo} ids={d.labels}/></td><td className="px-4 py-3"><LeaseBadge mode={d.mode}/><p className="mt-1 whitespace-nowrap text-[11px] text-slate-500">{d.mode === "MONTHLY" ? money(d.amount) + " / 月" : d.mode === "DAILY" ? "コース別の日額" : ""}</p>{linkedVehicleId(d, target.date ?? "2026-09-07") && <p className="mt-1 whitespace-nowrap text-[10px] text-slate-500">{demo.vehicles.find(v => v.id === linkedVehicleId(d, target.date ?? "2026-09-07"))?.plate}</p>}</td><td className="px-4 py-3"><span className="whitespace-nowrap rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">未設定</span></td><td className="px-4 py-3 text-xs text-slate-600">ドライバー</td></tr>)}</tbody></table></div>
      <div className="divide-y divide-slate-100 md:hidden">{drivers.map(d => <button key={d.id} aria-label={`${d.name}のラベル・契約を編集`} onClick={() => open(d)} className="flex w-full items-center gap-3 px-4 py-3 text-left"><span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><FontAwesomeIcon icon={faUser}/></span><div className="min-w-0 flex-1"><span className="text-sm font-semibold text-slate-900">{d.name}</span><div className="mt-1.5"><Labels demo={demo} ids={d.labels}/></div></div><LeaseBadge mode={d.mode}/></button>)}</div>
    </div>}
    <p className="mt-3 text-[11px] text-slate-500">ドライバーを選ぶとラベル・リース契約を編集できます。その他の属性は配置確認用です。</p>
    {editor}
    {labelsOpen && <LabelEditor demo={demo} setDemo={setDemo} notify={notify} setDirty={setDirty} guard={guard} confirm={confirm} onClose={() => guard(() => { setLabelsOpen(false); setDirty(false); })}/>}
  </div>;
}

function LabelEditor({ demo, setDemo, notify, confirm, setDirty, guard, onClose }: Pick<PageProps, "demo" | "setDemo" | "notify" | "confirm" | "setDirty" | "guard"> & { onClose: () => void }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const save = () => {
    const value = name.trim();
    if (!value || value.length > 20) { setError("ラベル名は1〜20文字で入力してください。"); return; }
    if (demo.labels.some(l => l.id !== editing && l.name.toLocaleLowerCase() === value.toLocaleLowerCase())) { setError("同じ名前のラベルがすでにあります。"); return; }
    setDemo({ ...demo, labels: editing ? demo.labels.map(l => l.id === editing ? { ...l, name: value } : l) : [...demo.labels, { id: `label-${Date.now()}`, name: value }] });
    setName(""); setEditing(null); setDirty(false); setError(""); notify("ラベルを保存しました");
  };
  return <EditorModal title="ラベルを編集" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); save(); }} className="flex flex-wrap gap-2">
      <input aria-label="ラベル名" placeholder="ラベル名" className={inputClass + " min-w-32 flex-1"} value={name} maxLength={20} onChange={event => { setName(event.target.value); setDirty(true); setError(""); }}/>
      <button className={primaryClass} type="submit">{editing ? "変更を保存" : "追加"}</button>
      {editing && <button className={buttonClass} type="button" onClick={() => guard(() => { setEditing(null); setName(""); setDirty(false); setError(""); })}>キャンセル</button>}
    </form>
    <div className="mt-3"><ErrorMessage message={error}/></div>
    <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="ラベル一覧">
      {demo.labels.map(label => {
        const count = demo.drivers.filter(driver => driver.labels.includes(label.id)).length;
        return <div key={label.id} className="flex items-center gap-2 px-3 py-1">
          <span className="min-w-0 flex-1 break-words text-sm font-medium">{label.name}</span><span className="whitespace-nowrap text-xs text-slate-400">{count}人</span>
          <button aria-label={`${label.name}の名前を変更`} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50" onClick={() => guard(() => { setEditing(label.id); setName(label.name); setDirty(false); setError(""); })}><FontAwesomeIcon icon={faPen}/></button>
          <button aria-label={`${label.name}を削除`} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => confirm("ラベルを削除しますか？", `「${label.name}」を${count}人から外します。リース契約やシフトは変わりません。`, () => {
            setDemo({ ...demo, labels: demo.labels.filter(item => item.id !== label.id), drivers: demo.drivers.map(driver => ({ ...driver, labels: driver.labels.filter(id => id !== label.id) })) });
            if (editing === label.id) { setEditing(null); setName(""); setDirty(false); }
            notify("ラベルを削除しました");
          }, "削除する")}><FontAwesomeIcon icon={faTrashCan}/></button>
        </div>;
      })}
      {!demo.labels.length && <p className="p-4 text-xs text-slate-500">ラベルはまだありません。上の欄から追加できます。</p>}
    </div>
    <div className="mt-4 flex items-center justify-between gap-3"><p className="min-w-0 flex-1 text-xs text-slate-500">付けるドライバーは一覧から選んで編集できます。</p><button className={buttonClass + " shrink-0 whitespace-nowrap"} onClick={onClose}>閉じる</button></div>
  </EditorModal>;
}
