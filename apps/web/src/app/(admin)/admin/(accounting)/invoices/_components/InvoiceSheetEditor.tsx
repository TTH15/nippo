"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { exportInvoicePdf, invoicePdfFileName } from "@/lib/invoicePdf";
import { InvoiceSheet } from "./InvoiceSheet";
import {
  type EditorState,
  blankEditorState,
  saveBodyFromEditor,
} from "./editorModel";
import { type InvoiceKind } from "./invoiceKinds";

// WYSIWYG エディタ。帳票上で直接インライン編集（InvoiceSheet）し、上部のスリムな
// ツールバーでインライン化できない操作（種別・消費税・取引先/ドライバー選択・保存・PDF）を行う。

type AddressRow = { id: string; name: string; postal_code?: string; address?: string; phone?: string; invoice_no?: string };
type DriverRow = {
  id: string; name: string; display_name?: string | null;
  postal_code?: string | null; address?: string | null; phone?: string | null;
  bank_name?: string | null; bank_no?: string | null; bank_holder?: string | null;
};

function addrHtml(postal?: string | null, address?: string | null): string {
  const p = postal ?? ""; const a = address ?? "";
  if (!p && !a) return "";
  return p ? `〒${p}<br/>${a}` : a;
}

const barBtn = "rounded-lg px-3 py-1.5 text-sm border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

export function InvoiceSheetEditor({ initial, mode }: { initial: EditorState; mode: "new" | "edit" }) {
  const router = useRouter();
  const [st, setSt] = useState<EditorState>(initial);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const { data: addrData } = useApi<{ addresses: AddressRow[] }>(
    st.kind === "outgoing" ? "/api/admin/invoice-addresses" : null,
  );
  const addresses = addrData?.addresses ?? [];
  const { data: driverData } = useApi<{ drivers: DriverRow[] }>(
    st.kind === "incoming" ? "/api/admin/users?limit=500" : null,
  );
  const drivers = driverData?.drivers ?? [];

  const changeKind = (kind: InvoiceKind) =>
    setSt((prev) => {
      const base = blankEditorState(kind);
      return { ...prev, kind, showStamp: base.showStamp, toName: base.toName, fromName: base.fromName, parties: base.parties };
    });

  const selectCounterparty = (id: string) => {
    const a = addresses.find((x) => x.id === id);
    setSt((prev) => ({
      ...prev,
      counterpartyInvoiceAddressId: id || null,
      toName: a ? a.name : prev.toName,
      toAddrHtml: a ? addrHtml(a.postal_code, a.address) : prev.toAddrHtml,
      toTel: a ? a.phone ?? "" : prev.toTel,
      toReg: a ? a.invoice_no ?? "" : prev.toReg,
      parties: { ...prev.parties, toParty: id ? `corp-${id}` : prev.parties.toParty },
    }));
  };

  const selectDriver = (id: string) => {
    const d = drivers.find((x) => x.id === id);
    setSt((prev) => ({
      ...prev,
      fromName: d ? d.display_name || d.name : prev.fromName,
      fromAddrHtml: d ? addrHtml(d.postal_code, d.address) : prev.fromAddrHtml,
      fromTel: d ? d.phone ?? "" : prev.fromTel,
      bankName: d ? d.bank_name ?? "" : prev.bankName,
      bankNo: d ? d.bank_no ?? "" : prev.bankNo,
      bankHolder: d ? d.bank_holder ?? "" : prev.bankHolder,
      parties: { ...prev.parties, fromParty: id ? `drv-${id}` : prev.parties.fromParty },
    }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = saveBodyFromEditor(st);
      const isEdit = mode === "edit" && Boolean(st.id);
      const url = isEdit ? `/api/admin/invoices/${encodeURIComponent(st.id as string)}` : "/api/admin/invoices";
      const res = (await apiFetch(url, { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(body) })) as { invoice?: { id?: string }; id?: string };
      const id = res?.invoice?.id ?? res?.id ?? st.id;
      router.push(id ? `/admin/invoices/${encodeURIComponent(id)}/preview` : "/admin/invoices");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async () => {
    if (!sheetRef.current) return;
    setPdfBusy(true);
    try {
      await exportInvoicePdf(sheetRef.current, invoicePdfFileName(st.period, st.fromName));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* スリムなツールバー（PDFには含めない） */}
      <div className="hide-print flex flex-wrap items-center gap-3 px-4 py-2 bg-white border-b border-slate-200">
        <a href="/admin/invoices" className="text-sm text-slate-600 underline hover:text-slate-900">一覧</a>

        <div className="flex gap-1">
          {(["outgoing", "incoming"] as const).map((k) => (
            <button key={k} type="button" disabled={mode === "edit"} onClick={() => changeKind(k)}
              className={"rounded-lg px-3 py-1.5 text-sm border " + (st.kind === k ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50") + (mode === "edit" ? " opacity-60 cursor-not-allowed" : "")}>
              {k === "outgoing" ? "売上請求書" : "受領請求書"}
            </button>
          ))}
        </div>

        {st.kind === "outgoing" ? (
          <select className={barBtn} value={st.counterpartyInvoiceAddressId ?? ""} onChange={(e) => selectCounterparty(e.target.value)}>
            <option value="">請求先（取引先）を選択…</option>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : (
          <select className={barBtn} value={st.parties.fromParty.startsWith("drv-") ? st.parties.fromParty.slice(4) : ""} onChange={(e) => selectDriver(e.target.value)}>
            <option value="">請求元（ドライバー）を選択…</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.display_name || d.name}</option>)}
          </select>
        )}

        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={st.taxEnabled} onChange={(e) => setSt((p) => ({ ...p, taxEnabled: e.target.checked }))} />
          消費税
          <input className="w-14 rounded border border-slate-300 px-2 py-1 text-sm text-right" value={st.taxRatePercent} inputMode="decimal" onChange={(e) => setSt((p) => ({ ...p, taxRatePercent: e.target.value }))} />%
        </label>

        <div className="ml-auto flex items-center gap-2">
          {error ? <span className="text-sm text-red-600">{error}</span> : null}
          <button onClick={() => window.print()} className={barBtn}>印刷</button>
          <button onClick={downloadPdf} disabled={pdfBusy} className={barBtn + " disabled:opacity-50"}>{pdfBusy ? "PDF生成中…" : "PDF"}</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{saving ? "保存中…" : "保存"}</button>
        </div>
      </div>

      {/* 帳票（直接インライン編集） */}
      <div className="flex-1 overflow-auto">
        <InvoiceSheet state={st} onChange={setSt} sheetRef={sheetRef} />
      </div>
    </div>
  );
}
