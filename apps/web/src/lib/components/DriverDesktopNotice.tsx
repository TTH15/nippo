"use client";

// PC 幅ではドライバー画面を提供しない（PC = 運営画面前提）。
// (user) レイアウトが md 以上でコンテンツの代わりにこれを表示する。
// 運営権限（capability を1つでも保持）があれば運営画面への導線を出す。
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getStoredDriver } from "@/lib/api";

export function DriverDesktopNotice() {
  const [canAdmin, setCanAdmin] = useState(false);

  useEffect(() => {
    setCanAdmin((getStoredDriver()?.capabilities?.length ?? 0) > 0);
  }, []);

  return (
    <div className="hidden min-h-screen flex-col items-center justify-center gap-3 px-6 text-center md:flex">
      <Image
        src="/logo/hakotora-logo_secondary_logo.svg"
        alt="ハコ虎"
        width={144}
        height={48}
        className="h-12 w-auto"
        priority
      />
      <p className="mt-2 text-sm font-semibold text-slate-700">
        ドライバー画面はPC表示に対応していません
      </p>
      <p className="text-xs text-slate-500">スマートフォンからご利用ください。</p>
      {canAdmin && (
        <Link
          href="/admin"
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          運営画面を開く
        </Link>
      )}
    </div>
  );
}
