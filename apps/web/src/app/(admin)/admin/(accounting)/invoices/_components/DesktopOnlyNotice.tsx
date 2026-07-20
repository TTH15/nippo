"use client";

// 請求書の作成・編集は A4 帳票（210mm）を扱うため、狭い画面では実用にならない。
// new / edit の両方で同じ案内を出すための共有コンポーネント。
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDesktop } from "@fortawesome/free-solid-svg-icons";
import { Button } from "@/lib/ui/button";

/** lg 未満なら false。判定前は null（チラつき防止に描画を保留するため） */
export function useIsDesktop(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function DesktopOnlyNotice({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <FontAwesomeIcon icon={faDesktop} className="h-6 w-6" />
        </span>
        <h1 className="text-base font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          請求書の作成・編集は幅の広い画面が必要です。PCのブラウザからアクセスしてください。
        </p>
        <Button asChild variant="default" size="default" className="mt-5">
          <a href="/admin/invoices">請求書一覧へ戻る</a>
        </Button>
      </div>
    </div>
  );
}
