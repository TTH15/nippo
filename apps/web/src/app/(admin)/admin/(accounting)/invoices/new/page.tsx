"use client";

import { AdminLayout } from "@/lib/components/AdminLayout";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDesktop } from "@fortawesome/free-solid-svg-icons";
import { hasCapability } from "@/lib/capabilities";
import { useApi } from "@/lib/useApi";
import { Button } from "@/lib/ui/button";
import { InvoiceSheetEditor } from "../_components/InvoiceSheetEditor";
import {
  blankEditorState,
  emptyLine,
  periodForMonth,
  type EditorState,
  type EditorLine,
} from "../_components/editorModel";
import type { InvoiceKind } from "../_components/invoiceKinds";

type DraftResp = {
  month?: string;
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
    period: draft.month ? periodForMonth(draft.month) : base.period,
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
  const router = useRouter();

  // 旧「編集」リンク（new?invoiceId=...）の互換：編集ページへ転送。
  const invoiceId = searchParams?.get("invoiceId") ?? "";
  useEffect(() => {
    if (invoiceId) router.replace(`/admin/invoices/${encodeURIComponent(invoiceId)}/edit`);
  }, [invoiceId, router]);

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

  // 旧「編集」リンク（new?invoiceId=...）は編集ページへ転送中。
  if (invoiceId) {
    return (
      <AdminLayout>
        <div className="p-10 text-center text-slate-500">編集ページへ移動中…</div>
      </AdminLayout>
    );
  }

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
            <Button asChild variant="default" size="default" className="mt-5">
              <a href="/admin/invoices">請求書一覧へ戻る</a>
            </Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="-m-6">
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
