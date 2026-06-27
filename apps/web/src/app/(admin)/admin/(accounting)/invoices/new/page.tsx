"use client";

import { AdminLayout } from "@/lib/components/AdminLayout";
import { Suspense, useEffect, useState } from "react";
import { getStoredDriver } from "@/lib/api";
import { hasCapability } from "@/lib/capabilities";
import { useSearchParams } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDesktop } from "@fortawesome/free-solid-svg-icons";

function InvoiceNewPageContent() {
  const [canWrite, setCanWrite] = useState(false);
  // A4帳票ビルダー(iframe)はスマホ操作に不向きなため、PC幅(>=1024px)でのみ表示する。
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_billing"));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const iframeSrc = (() => {
    const qs = searchParams?.toString();
    if (!qs) return "/invoice/index.html";
    return `/invoice/index.html?${qs}`;
  })();

  if (!canWrite) {
    return (
      <AdminLayout>
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <p className="text-sm text-slate-700">
            閲覧専用アカウントでは利用できません。
          </p>
          <a
            href="/admin/invoices"
            className="inline-block mt-4 text-sm text-slate-700 underline hover:text-slate-900"
          >
            請求書一覧へ戻る
          </a>
        </div>
      </AdminLayout>
    );
  }

  // 判定前は何も描画しない（モバイルで一瞬 iframe が読み込まれるのを防ぐ）。
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
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              請求書の作成・編集はA4帳票エディタを使うため、スマホ・タブレットでは操作できません。
              PCのブラウザからアクセスしてください。
            </p>
            <a
              href="/admin/invoices"
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              請求書一覧へ戻る
            </a>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="-m-6">
        <iframe
          src={iframeSrc}
          className="w-full border-0"
          style={{ height: "calc(100vh - 0px)" }}
          title="請求書作成"
        />
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
