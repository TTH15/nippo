"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBuilding, faCloudArrowUp, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";

type Settings = {
  name: string;
  invoice_postal_code: string | null;
  invoice_address: string | null;
  invoice_tel: string | null;
  invoice_registration_no: string | null;
  invoice_bank_name: string | null;
  invoice_bank_no: string | null;
  invoice_bank_holder: string | null;
  stampUrl: string | null;
};

const EMPTY = { name: "", invoicePostalCode: "", invoiceAddress: "", invoiceTel: "", invoiceRegistrationNo: "", invoiceBankName: "", invoiceBankNo: "", invoiceBankHolder: "" };

export default function OrganizationSettingsPage() {
  const { data, isInitialLoading, mutate } = useApi<{ settings: Settings }>("/api/admin/organization-settings", { revalidateOnFocus: false });
  const [form, setForm] = useState(EMPTY);
  const [stampDataUrl, setStampDataUrl] = useState<string | null>(null);
  const [removeStamp, setRemoveStamp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canWrite = hasCapability("can_manage_org_settings");

  useEffect(() => {
    const s = data?.settings;
    if (!s) return;
    setForm({ name: s.name ?? "", invoicePostalCode: s.invoice_postal_code ?? "", invoiceAddress: s.invoice_address ?? "", invoiceTel: s.invoice_tel ?? "", invoiceRegistrationNo: s.invoice_registration_no ?? "", invoiceBankName: s.invoice_bank_name ?? "", invoiceBankNo: s.invoice_bank_no ?? "", invoiceBankHolder: s.invoice_bank_holder ?? "" });
  }, [data]);

  const stampPreview = removeStamp ? null : stampDataUrl ?? data?.settings.stampUrl ?? null;
  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      await apiFetch("/api/admin/organization-settings", { method: "PUT", body: JSON.stringify({ ...form, stampDataUrl, removeStamp }) });
      setStampDataUrl(null); setRemoveStamp(false); await mutate(); setMessage("会社設定を保存しました");
    } catch (e) { setMessage(e instanceof Error ? e.message : "保存に失敗しました"); }
    finally { setSaving(false); }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3"><FontAwesomeIcon icon={faBuilding} className="h-5 w-5 text-slate-500" /><div><h1 className="text-xl font-bold text-slate-900">会社設定</h1><p className="text-sm text-slate-500">請求書に表示する自社情報と社印を管理します。</p></div></div>
        {isInitialLoading ? <p className="text-sm text-slate-500">読み込み中…</p> : (
          <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
            <Field label="会社名" value={form.name} onChange={(v) => set("name", v)} disabled={!canWrite} />
            <div className="grid gap-4 sm:grid-cols-2"><Field label="郵便番号" value={form.invoicePostalCode} onChange={(v) => set("invoicePostalCode", v)} disabled={!canWrite} /><Field label="電話番号" value={form.invoiceTel} onChange={(v) => set("invoiceTel", v)} disabled={!canWrite} /></div>
            <Field label="住所" value={form.invoiceAddress} onChange={(v) => set("invoiceAddress", v)} disabled={!canWrite} />
            <Field label="適格請求書発行事業者 登録番号" value={form.invoiceRegistrationNo} onChange={(v) => set("invoiceRegistrationNo", v)} disabled={!canWrite} />
            <div className="border-t border-slate-100 pt-5"><h2 className="mb-3 text-sm font-semibold text-slate-800">振込先</h2><div className="space-y-3"><Field label="金融機関・支店" value={form.invoiceBankName} onChange={(v) => set("invoiceBankName", v)} disabled={!canWrite} /><Field label="口座種別・口座番号" value={form.invoiceBankNo} onChange={(v) => set("invoiceBankNo", v)} disabled={!canWrite} /><Field label="口座名義" value={form.invoiceBankHolder} onChange={(v) => set("invoiceBankHolder", v)} disabled={!canWrite} /></div></div>
            <div className="border-t border-slate-100 pt-5"><h2 className="mb-1 text-sm font-semibold text-slate-800">社印</h2><p className="mb-3 text-xs text-slate-500">PNG推奨。JPEG・WebPにも対応、2MB以下。</p><div className="flex flex-wrap items-center gap-4">{stampPreview ? <div className="flex h-36 w-36 items-center justify-center rounded-lg border border-slate-200 bg-white p-2"><img src={stampPreview} alt="登録中の社印" className="max-h-full max-w-full object-contain" /></div> : <div className="flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">未登録</div>}{canWrite && <div className="flex gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"><FontAwesomeIcon icon={faCloudArrowUp} className="h-4 w-4" />画像を選択<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { setMessage("社印画像は2MB以下にしてください"); return; } const reader = new FileReader(); reader.onload = () => { setStampDataUrl(String(reader.result)); setRemoveStamp(false); }; reader.readAsDataURL(file); }} /></label>{stampPreview && <button type="button" onClick={() => { setStampDataUrl(null); setRemoveStamp(true); }} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600"><FontAwesomeIcon icon={faTrashCan} className="h-4 w-4" />削除</button>}</div>}</div></div>
            {message && <p className="text-sm text-slate-600">{message}</p>}
            {canWrite && <div className="flex justify-end"><button type="button" disabled={saving || !form.name.trim()} onClick={() => void save()} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "保存中…" : "保存"}</button></div>}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">{label}</span><input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-50" /></label>;
}
