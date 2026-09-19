"use client";
import { useId, useState } from "react";
import { formatDateSlashWeekdayJP } from "@repo/core/logic/calendar";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { registerPasskey } from "@/lib/registerPasskey";
import { reauthHeaders, useRecentAuthAction } from "./RecentAuth";
import { SmoothCollapse } from "./SmoothCollapse";

type Key = { id: string; name: string | null; created_at: string; last_used_at: string | null };
export function PasskeyManagement() {
  const supported = useIsWebAuthnHost();
  const { data, error, isInitialLoading, refresh } = useApi<{ keys: Key[]; canRecoverWithSms: boolean }>("/api/me/passkeys");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const reauth = useRecentAuthAction();
  const collapseId = useId();
  const disabled = reauth.checking || reauth.verifying;
  return <section className="mt-6">
    <h2 className="mb-4 text-base font-bold text-slate-900">Passkeyの管理</h2>
    <div className="max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {isInitialLoading && <p role="status" className="text-sm text-slate-500">読み込み中...</p>}
      {error && <div role="alert" className="text-sm text-red-600">読み込めませんでした。
        <button type="button" onClick={() => refresh()} className="min-h-11 px-2 underline">もう一度読み込む</button>
      </div>}
      {data && <>
        {data.keys.length === 0 && <p className="text-sm text-slate-600">Passkeyはまだ登録されていません。</p>}
        <ul className="divide-y divide-slate-200">
          {data.keys.map((key, index) => <li key={key.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0 text-sm">
              <p className="break-words font-medium text-slate-900">{key.name || `Passkey ${index + 1}`}</p>
              <p className="text-xs text-slate-500">登録日 {formatDateSlashWeekdayJP(new Date(key.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }))}</p>
            </div>
            <button type="button" aria-label={`${key.name || `Passkey ${index + 1}`}を削除`}
              disabled={disabled || (data.keys.length === 1 && !data.canRecoverWithSms)}
              onClick={() => { setMessage(""); setSelected(key.id); }} aria-expanded={selected === key.id} aria-controls={collapseId}
              className="min-h-11 shrink-0 px-3 text-sm text-red-700 underline disabled:opacity-40">削除</button>
          </li>)}
        </ul>
        {data.keys.length === 1 && !data.canRecoverWithSms && <p className="text-sm text-slate-600">最後のPasskeyは、電話番号を確認するか、別のPasskeyを登録してから削除できます。</p>}
      </>}
      <SmoothCollapse open={!!selected} id={collapseId}>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">このPasskeyを削除します。次回から、このPasskeyではログインできません。</p>
          <button type="button" disabled={disabled} className="min-h-11 w-full rounded-lg bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => reauth.run(async (grant) => {
              await apiFetch("/api/me/passkeys", { method: "DELETE", headers: reauthHeaders(grant), body: JSON.stringify({ id: selected }) });
              setSelected(null); setMessage("Passkeyを削除しました"); await refresh();
            })}>削除する</button>
          <button type="button" disabled={disabled} onClick={() => setSelected(null)} className="min-h-11 w-full text-sm underline">取り消す</button>
        </div>
      </SmoothCollapse>
      {reauth.verification}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      {supported ? <button type="button" disabled={disabled || !!selected || !data} className="min-h-11 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        onClick={() => { setMessage(""); void reauth.run(async (grant) => {
          await registerPasskey(grant); setMessage("Passkeyを登録しました"); await refresh();
        }); }}>この端末にPasskeyを登録する</button>
        : <p className="text-sm text-slate-600">Passkeyの登録はSafariやChromeで開いて進めてください。</p>}
    </div>
  </section>;
}
