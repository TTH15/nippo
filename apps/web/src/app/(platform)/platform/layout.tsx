"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// プラットフォームコンソールの外枠。org 管理画面（/admin）と取り違えないよう
// ダークヘッダー＋「PLATFORM」表記の別ブランドにする。入場判定は各 API（requirePlatformAdmin）。
export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const nav = [
    { href: "/platform", label: "ダッシュボード" },
    { href: "/platform/applications", label: "申請" },
    { href: "/platform/account-recovery", label: "アカウント復旧" },
  ];
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="font-bold tracking-wide">ハコ虎</span>
            <span className="text-[11px] font-semibold text-amber-400 tracking-widest">PLATFORM</span>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            {nav.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`px-3 py-1.5 rounded-md text-sm ${active ? "bg-slate-700 text-white" : "text-slate-300 hover:text-white hover:bg-slate-800"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
