"use client";

import { AdminLayout } from "@/lib/components/AdminLayout";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { hasCapability } from "@/lib/capabilities";
import { useApi } from "@/lib/useApi";
import { InvoiceSheetEditor } from "../_components/InvoiceSheetEditor";
import { DesktopOnlyNotice } from "../_components/DesktopOnlyNotice";
import {
  blankEditorState,
  emptyLine,
  periodForMonth,
  addrHtml,
  type EditorState,
  type EditorLine,
} from "../_components/editorModel";
import type { InvoiceKind } from "../_components/invoiceKinds";

type DraftDriver = {
  id: string;
  name: string;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  bankName?: string | null;
  bankNo?: string | null;
  bankHolder?: string | null;
};

type DraftResp = {
  month?: string;
  section?: string;
  issueDate?: string;
  dueDate?: string;
  invoiceNo?: string;
  counterparty_invoice_address_id?: string | null;
  driver?: DraftDriver;
  tableData?: {
    main?: { title?: string; qty?: number; price?: number; unit?: string }[];
    deduct?: { title?: string; qty?: number; price?: number; unit?: string }[];
  };
};

function mapLines(rows?: { title?: string; qty?: number; price?: number; unit?: string }[]): EditorLine[] {
  if (!rows || rows.length === 0) return [emptyLine()];
  return rows.map((r) => ({
    title: String(r.title ?? ""),
    qty: r.qty == null ? "" : String(r.qty),
    unit: r.unit ?? "",
    price: r.price == null ? "" : String(r.price),
    priceBasis: "exclusive",
  }));
}

type DriverRow = {
  id: string;
  name: string;
  postal_code?: string | null;
  address?: string | null;
  phone?: string | null;
};

/** 自社 → ドライバー個人の空の下書き（明細は手入力）。振込先は自社口座のまま。 */
function buildDriverRecipientInitial(
  month: string,
  driverId: string,
  driver: DriverRow | undefined,
): EditorState {
  const base = blankEditorState("outgoing");
  return {
    ...base,
    period: month ? periodForMonth(month) : base.period,
    honorific: "様",
    toName: driver?.name ?? "",
    toAddrHtml: addrHtml(driver?.postal_code, driver?.address),
    toTel: driver?.phone ?? "",
    parties: { ...base.parties, toParty: `drv-${driverId}` },
  };
}

function buildInitial(kind: InvoiceKind, draft: DraftResp | undefined): EditorState {
  const base = blankEditorState(kind);
  if (!draft) return base;
  const driver = kind === "incoming" ? draft.driver : undefined;
  return {
    ...base,
    section: draft.section ?? base.section,
    period: draft.month ? periodForMonth(draft.month) : base.period,
    invoiceNo: draft.invoiceNo ?? "",
    dueDate: draft.dueDate ?? "",
    counterpartyInvoiceAddressId: draft.counterparty_invoice_address_id ?? null,
    main: mapLines(draft.tableData?.main),
    deduct: mapLines(draft.tableData?.deduct),
    ...(driver
      ? {
          fromName: driver.name,
          fromAddrHtml: addrHtml(driver.postalCode, driver.address),
          fromTel: driver.phone ?? "",
          bankName: driver.bankName ?? "",
          bankNo: driver.bankNo ?? "",
          bankHolder: driver.bankHolder ?? "",
          parties: { ...base.parties, fromParty: `drv-${driver.id}` },
        }
      : {}),
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
  const driver = searchParams?.get("driver") ?? "";
  // 自社 → ドライバー個人（売上請求書）。自動集計は行わず空の下書きから始める。
  const toDriver = kind === "outgoing" ? (searchParams?.get("toDriver") ?? "") : "";
  const wantDraft =
    kind === "incoming" ? Boolean(month && driver) : Boolean(!toDriver && month && section);
  const draftKey = wantDraft
    ? kind === "incoming"
      ? `/api/admin/invoices/draft?month=${encodeURIComponent(month)}&driver=${encodeURIComponent(driver)}`
      : `/api/admin/invoices/draft?month=${encodeURIComponent(month)}&section=${encodeURIComponent(section)}${counterparty ? `&counterparty=${encodeURIComponent(counterparty)}` : ""}`
    : null;
  const { data: draft, isInitialLoading: draftLoading } = useApi<DraftResp>(draftKey);

  // 宛先ドライバーの氏名・住所は開く前に確定させる（エディタ側の自動保存が
  // 「開いただけ」で空の請求書を作らないよう、初期状態に含めてから渡す）。
  // キーはエディタ側の取得と同一なので追加のリクエストにはならない。
  const { data: driverData, isInitialLoading: driversLoading } = useApi<{ drivers: DriverRow[] }>(
    toDriver ? "/api/admin/users?all=1&status=all" : null,
  );
  const recipientDriver = toDriver
    ? (driverData?.drivers ?? []).find((d) => d.id === toDriver)
    : undefined;

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
        <DesktopOnlyNotice title="請求書の作成はPCでご利用ください" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="-mx-3 -my-4 md:-m-6">
        {(wantDraft && draftLoading) || (toDriver && driversLoading) ? (
          <div className="p-10 text-center text-slate-500">下書きを読み込み中…</div>
        ) : (
          <InvoiceSheetEditor
            mode="new"
            initial={
              toDriver
                ? buildDriverRecipientInitial(month, toDriver, recipientDriver)
                : buildInitial(kind, wantDraft ? draft : undefined)
            }
          />
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
