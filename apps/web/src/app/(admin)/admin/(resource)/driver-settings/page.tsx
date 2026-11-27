"use client";

import { useRef, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { VehiclePlate, formatPlateNumeric } from "@/lib/components/VehiclePlate";
import { EditorModal } from "@/lib/components/EditorModal";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { Skeleton } from "@/lib/components/Skeleton";
import { Button } from "@/lib/ui/button";
import { useApi } from "@/lib/useApi";
import { apiFetch } from "@/lib/api";
import { driverSettingsPath, leaseLabels, type DriverSettings, type DriverSettingsRow } from "@/lib/drivers/settings";
import type { LeaseSettingsState } from "@/lib/drivers/leaseSettings";

const leasePath = "/api/admin/driver-lease";
type Edit = { kind: "vehicles" | "lease"; row: DriverSettingsRow };
const errorText = (error: unknown) => error instanceof Error ? error.message : "保存できませんでした。もう一度お試しください。";

function SettingEditor({ edit, data, close, saved }: { edit: Edit; data: DriverSettings; close: () => void; saved: () => Promise<void> }) {
  const { row, kind } = edit;
  const [ids, setIds] = useState(row.vehicleIds);
  const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const lease = useApi<LeaseSettingsState>(kind === "lease" ? leasePath + "?driver_id=" + row.id : null);
  const [baseline, setBaseline] = useState<LeaseSettingsState>();
  const contract = baseline ?? lease.data;
  const [mode, setMode] = useState<keyof typeof leaseLabels | undefined>();
  const [amount, setAmount] = useState<string | undefined>();
  const leaseMode = mode ?? contract?.lease?.mode ?? "NONE";
  const leaseAmount = amount ?? String(contract?.lease?.amount || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const valid = kind === "vehicles" ? [...ids].sort().join() !== [...row.vehicleIds].sort().join()
    : !!contract && (leaseMode !== (contract.lease?.mode ?? "NONE") || (leaseMode === "MONTHLY" && Number(leaseAmount) !== contract.lease?.amount))
      && (leaseMode !== "MONTHLY" || (/^\d+$/.test(leaseAmount) && Number(leaseAmount) > 0 && Number(leaseAmount) <= 2147483647));

  async function save() {
    if (!valid || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (kind === "vehicles") {
        await apiFetch(driverSettingsPath, { method: "PATCH", body: JSON.stringify({ driverId: row.id, field: "vehicles", value: ids, expected: row.vehicleIds }) });
      } else {
        await apiFetch(leasePath, { method: "PUT", body: JSON.stringify({ driver_id: row.id, enabled: leaseMode !== "NONE",
          mode: leaseMode === "DAILY" ? "DAILY" : "MONTHLY", amount: leaseMode === "MONTHLY" ? Number(leaseAmount) : 0,
          valid_from: month + "-01", expected_revision: contract?.revision }) });
        await lease.refresh();
      }
      await saved();
      close();
    } catch (e) { setError(errorText(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <EditorModal title={row.name + "の" + (kind === "lease" ? "リース区分" : "紐付け車両")} onClose={() => { if (!busy) close(); }} dismissible={!busy}
    footer={<div className="flex justify-end"><Button disabled={busy || !valid} onClick={save}>{busy ? "保存中…" : "保存"}</Button></div>}>
    {kind === "vehicles" ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {data.vehicles.map(v => <VehiclePlate key={v.id} vehicle={v} compact glow={false} selected={ids.includes(v.id)}
        onClick={() => setIds(previous => previous.includes(v.id) ? previous.filter(id => id !== v.id) : [...previous,v.id])} />)}
      {!data.vehicles.length && <p className="col-span-full">登録車両がありません。</p>}
    </div> : lease.error ? <button onClick={() => void lease.refresh()}>契約を再読み込み</button> : !lease.data ? <Skeleton className="h-16" /> :
      <div className="space-y-3 text-sm">
        <CustomSelect clearable={false} ariaLabel="リース区分" value={leaseMode} options={Object.entries(leaseLabels).map(([value,label]) => ({ value,label }))}
          onChange={v => { setBaseline(contract); setMode(v as keyof typeof leaseLabels); }} />
        {leaseMode === "MONTHLY" && <label className="block">月額（円）<input inputMode="numeric" className="mt-1 block w-full rounded border p-2" value={leaseAmount} onChange={e => { setBaseline(contract); setAmount(e.target.value); }} /></label>}
        <p className="text-slate-600">{year}年{monthNumber}月分から報酬のリース控除に適用します。</p>
        {lease.data.upcoming.length > 0 && <p className="text-slate-600">翌月以降に予約済みの契約があります。</p>}
      </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </EditorModal>;
}

export default function DriverSettingsPage() {
  const { data, error, refresh } = useApi<DriverSettings>(driverSettingsPath);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [pending, setPending] = useState("");
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const rows = data?.drivers.filter(row => row.name.replace(/\s/g,"").includes(query.trim().replace(/\s/g,""))) ?? [];

  async function toggle(row: DriverSettingsRow, value: boolean) {
    if (lock.current) return;
    lock.current = true;
    setPending(row.id);
    setMessage("");
    setSaveError("");
    try {
      await apiFetch(driverSettingsPath, { method: "PATCH", body: JSON.stringify({ driverId: row.id, field: "parking", expected: row.parking, value }) });
      await refresh();
      setMessage(row.name + "の設定を保存しました。");
    } catch (e) { setSaveError(errorText(e)); } finally { lock.current = false; setPending(""); }
  }
  const open = (kind: Edit["kind"], row: DriverSettingsRow) => { setMessage(""); setSaveError(""); setEdit({ kind, row }); };
  return <AdminLayout><main className="min-w-0 space-y-4">
    <h1 className="text-xl font-bold text-slate-900">ドライバー設定</h1>
    <div className="flex flex-wrap items-center gap-3"><input type="search" aria-label="ドライバー名で検索" placeholder="ドライバー名で検索"
      value={query} onChange={e => setQuery(e.target.value)} className="min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm sm:w-64" />
      {data && <span className="text-sm text-slate-500">{rows.length}人</span>}
      <span role="status" className="text-sm text-slate-600">{message}</span></div>
    {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
    {error && <div role="alert">設定を読み込めませんでした。 <Button variant="outline" onClick={() => void refresh()}>再読み込み</Button></div>}
    {!data && !error && <Skeleton className="h-48 w-full" />}
    {data && <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="block w-full text-left text-sm lg:table"><thead className="sr-only bg-slate-50 text-xs text-slate-600 lg:not-sr-only lg:table-header-group"><tr>
        {["ドライバー", ...(data.permissions.viewLease ? ["リース区分"] : []), ...(data.permissions.viewVehicles ? ["紐付け車両"] : []), "返却場所の登録"].map(title => <th key={title} scope="col" className="px-4 py-3 font-medium">{title}</th>)}
      </tr></thead><tbody className="block divide-y divide-slate-200 lg:table-row-group">
      {rows.map(row => <tr key={row.id} className="grid grid-cols-2 gap-x-2 gap-y-2 p-4 lg:table-row">
        <th scope="row" className="col-span-2 break-words pb-1 text-base font-semibold lg:px-4 lg:py-3 lg:text-sm">{row.name}</th>
        {data.permissions.viewLease && <td className="lg:px-4 lg:py-2"><span className="block text-xs text-slate-500 lg:hidden">リース区分</span>
          <button disabled={!data.permissions.editLease} aria-label={row.name + "のリース区分を変更"} onClick={() => open("lease",row)} className="min-h-11 text-left enabled:underline enabled:decoration-slate-300 enabled:underline-offset-4">{leaseLabels[row.lease ?? "NONE"]}</button></td>}
        {data.permissions.viewVehicles && <td className="lg:px-4 lg:py-2"><span className="block text-xs text-slate-500 lg:hidden">紐付け車両</span>
          <button disabled={!data.permissions.editVehicles} onClick={() => open("vehicles",row)} aria-label={row.name + "の紐付け車両を変更"} className="min-h-11 text-left enabled:underline enabled:decoration-slate-300 enabled:underline-offset-4">
          {row.vehicleIds.map(id => { const v = data.vehicles.find(item => item.id === id); return v?.number_numeric ? formatPlateNumeric(v.number_numeric) : v?.brand || "登録車両"; }).join("、") || "未設定"}</button></td>}
        <td className="lg:px-4 lg:py-2"><span className="block text-xs text-slate-500 lg:hidden">返却場所の登録</span>
          <CheckboxField className="w-fit" label={pending === row.id ? "保存中…" : row.parking ? "必要" : "不要"} checked={row.parking}
            aria-label={row.name + "の返却場所の登録を必須にする"} disabled={!!pending || !data.permissions.editRequirements}
            onCheckedChange={value => void toggle(row,value)} /></td>
      </tr>)}</tbody></table>
      {!rows.length && <p className="p-6 text-center text-sm text-slate-500">{query ? "一致するドライバーがいません。" : "稼働中のドライバーがいません。"}</p>}
    </div>}
    {edit && data && <SettingEditor key={edit.row.id + edit.kind} data={data} edit={edit} close={() => setEdit(null)} saved={async () => { await refresh(); setMessage(edit.row.name + "の設定を保存しました。"); }} />}
  </main></AdminLayout>;
}
