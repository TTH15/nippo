"use client";

import { AdminLayout } from "@/lib/components/AdminLayout";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDesktop } from "@fortawesome/free-solid-svg-icons";
import { hasCapability } from "@/lib/capabilities";
import { useApi } from "@/lib/useApi";
import { InvoiceSheetEditor } from "../_components/InvoiceSheetEditor";
import {
  blankEditorState,
  emptyLine,
  type EditorState,
  type EditorLine,
} from "../_components/editorModel";
import type { InvoiceKind } from "../_components/invoiceKinds";

type DraftResp = {
  section?: string;
  issueDate?: string;
  dueDate?: string;
  invoiceNo?: string;
  counterparty_invoice_address_id?: string | null;
  tableData?: {
    main?: { title?: string; qty?: number; price?: number }[];
    deduct?: { title?: string; qty?: number; price?: number }[];
  };
};

function mapLines(rows?: { title?: string; qty?: number; price?: number }[]): EditorLine[] {
  if (!rows || rows.length === 0) return [emptyLine()];
  return rows.map((r) => ({
    title: String(r.title ?? ""),
    qty: r.qty == null ? "" : String(r.qty),
    unit: "",
    price: r.price == null ? "" : String(r.price),
  }));
}

function buildInitial(kind: InvoiceKind, draft: DraftResp | undefined): EditorState {
  const base = blankEditorState(kind);
  if (!draft) return base;
  return {
    ...base,
    section: draft.section ?? base.section,
    invoiceNo: draft.invoiceNo ?? "",
    dueDate: draft.dueDate ?? "",
    counterpartyInvoiceAddressId: draft.counterparty_invoice_address_id ?? null,
    main: mapLines(draft.tableData?.main),
    deduct: mapLines(draft.tableData?.deduct),
  };
}

function InvoiceNewPageContent() {
  const [canWrite, setCanWrite] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => setCanWrite(hasCapability("can_manage_billing")), []);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const kind: InvoiceKind = searchParams?.get("kind") === "incoming" ? "incoming" : "outgoing";
  const month = searchParams?.get("month") ?? "";
  const section = searchParams?.get("section") ?? "";
  const counterparty = searchParams?.get("counterparty") ?? "";
  const wantDraft = Boolean(month && section);
  const draftKey = wantDraft
    ? `/api/admin/invoices/draft?month=${encodeURIComponent(month)}&section=${encodeURIComponent(section)}${counterparty ? `&counterparty=${encodeURIComponent(counterparty)}` : ""}`
    : null;
  const { data: draft, isInitialLoading: draftLoading } = useApi<DraftResp>(draftKey);

  const legacySrc = (() => {
    const qs = searchParams?.toString();
    return qs ? `/invoice/index.html?${qs}` : "/invoice/index.html";
  })();

  if (!canWrite) {
    return (
      <AdminLayout>
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <p className="text-sm text-slate-700">閲覧専用アカウントでは利用できません。</p>
          <a href="/admin/invoices" className="inline-block mt-4 text-sm text-slate-700 underline hover:text-slate-900">請求書一覧へ戻る</a>
        </div>
      </AdminLayout>
    );
  }

  if (isDesktop === null) {
    return (
      <AdminLayout>
        <div className="h-40" />
      </AdminLayout>
    );
  }

  if (!isDesktop) {
    return (
      <AdminLayout>
        <div className="mx-auto max-w-md py-10">
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <FontAwesomeIcon icon={faDesktop} className="h-6 w-6" />
            </span>
            <h1 className="text-base font-semibold text-slate-900">請求書の作成はPCでご利用ください</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">請求書の作成・編集は幅の広い画面が必要です。PCのブラウザからアクセスしてください。</p>
            <a href="/admin/invoices" className="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">請求書一覧へ戻る</a>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="-m-6">
        <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center justify-end">
          <a href={legacySrc} target="_blank" rel="noreferrer" className="text-xs text-slate-500 underline hover:text-slate-900">
            従来エディタ（自動集計・アドレス帳・添付）
          </a>
        </div>
        {wantDraft && draftLoading ? (
          <div className="p-10 text-center text-slate-500">下書きを読み込み中…</div>
        ) : (
          <InvoiceSheetEditor mode="new" initial={buildInitial(kind, wantDraft ? draft : undefined)} />
        )}
      </div>
    </AdminLayout>
  );
}

export default function InvoiceNewPage() {
  return (
    <Suspense fallback={null}>
      <InvoiceNewPageContent />
    </Suspense>
  );
}
