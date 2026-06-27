"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { InvoiceDocument } from "./InvoiceDocument";
import {
  type EditorState,
  type EditorLine,
  blankEditorState,
  docDataFromEditor,
  saveBodyFromEditor,
} from "./editorModel";
import { INVOICE_KIND_CONFIG, type InvoiceKind } from "./invoiceKinds";

// 請求書エディタ（売上/受領 共通）。左＝入力フォーム、右＝ライブプレビュー（InvoiceDocument 再利用）。
// 計算は @repo/core、保存は /api/admin/invoices（POST=新規 / PATCH=編集）。

type AddressRow = {
  id: string;
  name: string;
  postal_code?: string;
  address?: string;
  phone?: string;
  invoice_no?: string;
};

type DriverRow = {
  id: string;
  name: string;
  display_name?: string | null;
  postal_code?: string | null;
  address?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  bank_no?: string | null;
  bank_holder?: string | null;
};

function addrHtml(postal?: string, address?: string): string {
  const p = postal ?? "";
  const a = address ?? "";
  if (!p && !a) return "";
  return p ? `〒${p}<br/>${a}` : a;
}

const labelCls = "block text-xs font-medium text-slate-600 mb-1";
const inputCls =
  "w-full rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400";
const cellInputCls =
  "w-full rounded border border-slate-200 px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400";

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input
        className={inputCls}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function LineEditor({
  title,
  color,
  lines,
  onChange,
}: {
  title: string;
  color: string;
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
}) {
  const update = (i: number, patch: Partial<EditorLine>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const add = () => onChange([...lines, { title: "", qty: "", unit: "", price: "" }]);
  const remove = (i: number) => onChange(lines.filter((_, idx) => idx !== i));

  return (
    <div className="rounded-lg border border-slate-200">
      <div
        className="px-3 py-1.5 text-sm font-semibold text-white rounded-t-lg"
        style={{ backgroundColor: color }}
      >
        {title}
      </div>
      <div className="p-2 space-y-1.5">
        <div className="grid grid-cols-[1fr_60px_50px_80px_28px] gap-1 text-[11px] text-slate-500 px-1">
          <span>摘要</span>
          <span className="text-right">数量</span>
          <span className="text-center">単位</span>
          <span className="text-right">税抜単価</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_60px_50px_80px_28px] gap-1 items-center">
            <input className={cellInputCls} value={l.title} placeholder="摘要" onChange={(e) => update(i, { title: e.target.value })} />
            <input className={cellInputCls + " text-right"} value={l.qty} inputMode="decimal" placeholder="0" onChange={(e) => update(i, { qty: e.target.value })} />
            <input className={cellInputCls + " text-center"} value={l.unit} placeholder="件" onChange={(e) => update(i, { unit: e.target.value })} />
            <input className={cellInputCls + " text-right"} value={l.price} inputMode="decimal" placeholder="0" onChange={(e) => update(i, { price: e.target.value })} />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-slate-400 hover:text-red-500 text-sm"
              title="削除"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="mt-1 text-xs text-slate-600 hover:text-slate-900 underline"
        >
          ＋ 行を追加
        </button>
      </div>
    </div>
  );
}

export function InvoiceEditor({
  initial,
  mode,
}: {
  initial: EditorState;
  mode: "new" | "edit";
}) {
  const router = useRouter();
  const [st, setSt] = useState<EditorState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 取引先（請求先）アドレス帳。売上請求書の請求先セレクタで使用。
  const { data: addrData } = useApi<{ addresses: AddressRow[] }>(
    st.kind === "outgoing" ? "/api/admin/invoice-addresses" : null,
  );
  const addresses = addrData?.addresses ?? [];

  // ドライバー一覧。受領請求書の請求元（ドライバー）セレクタで使用。
  const { data: driverData } = useApi<{ drivers: DriverRow[] }>(
    st.kind === "incoming" ? "/api/admin/users?limit=500" : null,
  );
  const drivers = driverData?.drivers ?? [];

  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setSt((prev) => ({ ...prev, [key]: value }));

  // 取引先を選ぶと請求先の名称/住所/電話/登録番号を自動入力。
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

  // ドライバーを選ぶと請求元（氏名/住所/電話）と振込先（口座）を自動入力。
  const selectDriver = (id: string) => {
    const d = drivers.find((x) => x.id === id);
    setSt((prev) => ({
      ...prev,
      fromName: d ? d.display_name || d.name : prev.fromName,
      fromAddrHtml: d ? addrHtml(d.postal_code ?? undefined, d.address ?? undefined) : prev.fromAddrHtml,
      fromTel: d ? d.phone ?? "" : prev.fromTel,
      bankName: d ? d.bank_name ?? "" : prev.bankName,
      bankNo: d ? d.bank_no ?? "" : prev.bankNo,
      bankHolder: d ? d.bank_holder ?? "" : prev.bankHolder,
      parties: { ...prev.parties, fromParty: id ? `drv-${id}` : prev.parties.fromParty },
    }));
  };

  // 種別切替（新規時のみ）。請求元/先の向き・印鑑・ACEスロットを既定へ、入力済み明細は保持。
  const changeKind = (kind: InvoiceKind) => {
    setSt((prev) => {
      const base = blankEditorState(kind);
      return {
        ...prev,
        kind,
        showStamp: base.showStamp,
        toName: base.toName || (kind === prev.kind ? prev.toName : ""),
        fromName: base.fromName || (kind === prev.kind ? prev.fromName : ""),
        parties: base.parties,
      };
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = saveBodyFromEditor(st);
      const isEdit = mode === "edit" && Boolean(st.id);
      const url = isEdit
        ? `/api/admin/invoices/${encodeURIComponent(st.id as string)}`
        : "/api/admin/invoices";
      const res = (await apiFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(body),
      })) as { invoice?: { id?: string }; id?: string };
      const id = res?.invoice?.id ?? res?.id ?? st.id;
      if (id) router.push(`/admin/invoices/${encodeURIComponent(id)}/preview`);
      else router.push("/admin/invoices");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const T = (INVOICE_KIND_CONFIG[st.kind] ?? INVOICE_KIND_CONFIG.outgoing).theme;

  return (
    <div className="flex h-[calc(100vh-52px)]">
      {/* 左：フォーム */}
      <div className="w-[460px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-slate-900">
            {mode === "new" ? "請求書の作成" : "請求書の編集"}
          </h1>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        {error ? <div className="rounded bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div> : null}

        {/* 種別 */}
        <div>
          <span className={labelCls}>種別</span>
          <div className="flex gap-2">
            {(["outgoing", "incoming"] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={mode === "edit"}
                onClick={() => changeKind(k)}
                className={
                  "rounded-lg px-3 py-1.5 text-sm border " +
                  (st.kind === k
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50") +
                  (mode === "edit" ? " opacity-60 cursor-not-allowed" : "")
                }
              >
                {k === "outgoing" ? "売上請求書" : "受領請求書"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="対象期間" value={st.period} onChange={(v) => set("period", v)} placeholder="2025年5月1日〜2025年5月31日" />
          <Field label="請求書番号" value={st.invoiceNo} onChange={(v) => set("invoiceNo", v)} />
        </div>

        {st.kind === "outgoing" ? (
          <label className="block">
            <span className={labelCls}>請求先（取引先アドレス帳から選択）</span>
            <select
              className={inputCls}
              value={st.counterpartyInvoiceAddressId ?? ""}
              onChange={(e) => selectCounterparty(e.target.value)}
            >
              <option value="">— 選択 / 手入力 —</option>
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className={labelCls}>請求元（ドライバーを選択）</span>
            <select
              className={inputCls}
              value={st.parties.fromParty.startsWith("drv-") ? st.parties.fromParty.slice(4) : ""}
              onChange={(e) => selectDriver(e.target.value)}
            >
              <option value="">— 選択 / 手入力 —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.display_name || d.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="請求先 名称" value={st.toName} onChange={(v) => set("toName", v)} />
          <Field label="請求元 名称" value={st.fromName} onChange={(v) => set("fromName", v)} />
        </div>

        {/* 消費税 */}
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={st.taxEnabled} onChange={(e) => set("taxEnabled", e.target.checked)} />
            消費税
          </label>
          <label className="flex items-center gap-1">
            <input
              className="w-16 rounded border border-slate-300 px-2 py-1 text-sm text-right"
              value={st.taxRatePercent}
              inputMode="decimal"
              onChange={(e) => set("taxRatePercent", e.target.value)}
            />
            <span className="text-sm text-slate-600">%</span>
          </label>
        </div>

        {/* 明細 */}
        <LineEditor title={INVOICE_KIND_CONFIG[st.kind].billSectionTitle} color={T.bill} lines={st.main} onChange={(l) => set("main", l)} />
        <LineEditor title={INVOICE_KIND_CONFIG[st.kind].deductSectionTitle} color={T.deduct} lines={st.deduct} onChange={(l) => set("deduct", l)} />

        {/* サマリー手入力（売上のみ既定で使用） */}
        {st.kind === "outgoing" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="借入返済（−）" value={st.loanRepay} onChange={(v) => set("loanRepay", v)} />
            <Field label="追加外注支払い（＋・税込）" value={st.extraOutsourcing} onChange={(v) => set("extraOutsourcing", v)} />
          </div>
        ) : null}

        {/* 振込先 */}
        <div className="space-y-2">
          <Field label="振込期日" value={st.dueDate} onChange={(v) => set("dueDate", v)} />
          <Field label="振込先（金融機関）" value={st.bankName} onChange={(v) => set("bankName", v)} />
          <Field label="口座" value={st.bankNo} onChange={(v) => set("bankNo", v)} />
          <Field label="口座名義" value={st.bankHolder} onChange={(v) => set("bankHolder", v)} />
        </div>

        <a href="/admin/invoices" className="inline-block text-sm text-slate-500 underline hover:text-slate-900">
          一覧へ戻る
        </a>
      </div>

      {/* 右：ライブプレビュー */}
      <div className="flex-1 overflow-y-auto">
        <InvoiceDocument data={docDataFromEditor(st)} />
      </div>
    </div>
  );
}
