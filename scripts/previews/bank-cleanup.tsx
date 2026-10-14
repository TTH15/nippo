"use client";
import Link from "./kernel/next-link";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { Button } from "@/lib/ui/button";
import { apiFetch } from "@/lib/api";
import { hasCapability } from "@/lib/capabilities";
import { bankAccountFromStorage, bankAccountTypeDisplay, type BankStorage } from "@/lib/bankAccount";
import { bankStorageFields, type BankCleanupRow } from "@/lib/bankCleanup";
const endpoint = "/api/admin/bank-cleanup";
function Account({ bank }: { bank: BankStorage }) {
  const values = bankAccountFromStorage(bank);
  return <dl className="space-y-1 text-sm">{[["銀行名", bank.bank_name], ["支店名", bank.bank_branch_name], ["口座種別", bankAccountTypeDisplay(values)], ["口座番号", bank.bank_no], ["口座名義", bank.bank_holder]].map(([label, value]) => <div key={label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2"><dt className="text-slate-500">{label}</dt><dd className="break-words text-slate-900">{value || "—"}</dd></div>)}</dl>;
}
export default function BankCleanupPage() {
  const [rows, setRows] = useState<BankCleanupRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const load = async (offset = 0) => {
    setLoading(true); setError("");
    try {
      const data = await apiFetch<{ rows: BankCleanupRow[]; nextCursor: number | null }>(`${endpoint}?cursor=${offset}`);
      setRows(previous => offset ? [...previous, ...data.rows.filter(row => !previous.some(item => item.driver.id === row.driver.id))] : data.rows); setCursor(data.nextCursor);
      if (!offset) { setSelected(new Set()); setResults({}); }
    } catch (e) { setError(e instanceof Error ? e.message : "読み込みできませんでした"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const read = hasCapability("can_view_members") && hasCapability("can_view_bank_accounts");
    setAllowed(read); setCanWrite(hasCapability("can_manage_members"));
    if (read) void load();
  }, []);
  const save = async () => {
    setSaving(true);
    for (const row of rows.filter(row => selected.has(row.driver.id) && row.candidate && results[row.driver.id] !== "保存済み")) {
      const id = row.driver.id;
      try {
        await apiFetch(endpoint, { method: "POST", body: JSON.stringify({ id, before: Object.fromEntries(bankStorageFields.map(key => [key, row.driver[key] ?? null])), candidate: row.candidate }) });
        setRows(previous => previous.map(item => item.driver.id === id ? { ...item, driver: { ...item.driver, ...row.candidate! } } : item));
        setResults(previous => ({ ...previous, [id]: "保存済み" }));
        setSelected(previous => { const next = new Set(previous); next.delete(id); return next; });
      } catch (e) { setResults(previous => ({ ...previous, [id]: e instanceof Error ? e.message : "保存できませんでした" })); }
    }
    setSaving(false);
  };
  const visible = rows.filter(row => `${row.driver.name} ${row.driver.driver_code ?? ""}`.includes(search.trim()));
  return <AdminLayout><div className="mx-auto max-w-5xl space-y-4">
    <Link href="/admin/users" className="inline-flex min-h-11 items-center text-sm text-slate-600 underline">ドライバー管理へ戻る</Link>
    <h1 className="text-xl font-bold text-slate-900">口座情報を整える</h1>
    {allowed === false ? <p role="alert" className="text-sm text-red-700">口座情報を確認する権限がありません</p> : allowed && <>
      <div className="flex flex-wrap items-center gap-3"><input aria-label="名前・ドライバーコードで検索" placeholder="名前・ドライバーコード" value={search} onChange={e => setSearch(e.target.value)} className="h-11 min-w-0 rounded border border-slate-200 px-3 text-sm"/><Button variant="outline" disabled={loading || saving} onClick={() => void load()}>再読み込み</Button>{canWrite && <Button disabled={!selected.size || saving || loading} onClick={() => void save()}>{saving ? "保存中…" : `確認した${selected.size}件を保存`}</Button>}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!rows.length && !loading && !error && <p className="text-sm text-slate-500">読み込んだ範囲に整理が必要な口座はありません</p>}
      {rows.length > 0 && !visible.length && <p className="text-sm text-slate-500">条件に一致する口座情報がありません</p>}
      {visible.map(row => <section key={row.driver.id} aria-label={`${row.driver.name}の口座`} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{row.driver.name} <span className="ml-2 font-normal text-slate-500">{row.driver.driver_code}</span></h2>{results[row.driver.id] === "保存済み" ? <span role="status" className="text-sm text-green-700">保存済み</span> : row.candidate && canWrite ? <CheckboxField label={`${row.driver.name}：確認済み`} checked={selected.has(row.driver.id)} disabled={saving || loading} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); if (checked) next.add(row.driver.id); else next.delete(row.driver.id); return next; })}/> : <span className="text-xs text-amber-800">{row.reason || "閲覧のみ"}</span>}</div>
        <div className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-2 text-xs font-semibold text-slate-500">現在の保存内容</h3><Account bank={row.driver}/></div><div className="rounded bg-slate-50 p-3"><h3 className="mb-2 text-xs font-semibold text-slate-500">整理後の候補</h3>{row.candidate ? <Account bank={row.candidate}/> : <Link href="/admin/users" className="inline-flex min-h-11 items-center text-sm underline">ドライバー管理で確認</Link>}</div></div>
        {results[row.driver.id] && results[row.driver.id] !== "保存済み" && <p role="alert" className="mt-3 text-sm text-red-700">{results[row.driver.id]}</p>}
      </section>)}
      {loading && <p role="status" className="text-sm text-slate-500">読み込み中…</p>}
      {cursor !== null && <Button variant="outline" disabled={loading || saving} onClick={() => void load(cursor)}>さらに100件を確認</Button>}
    </>}
  </div></AdminLayout>;
}
