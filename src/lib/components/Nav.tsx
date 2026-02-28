"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { getStoredDriver, clearAuth } from "@/lib/api";

export function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const [driver, setDriver] = useState<{ id: string; name: string; role: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setDriver(getStoredDriver());
    setMounted(true);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const isAdmin = driver?.role === "ADMIN";

  const logout = () => {
    setMenuOpen(false);
    clearAuth();
    router.push(
      isAdmin ? "/admin/portal-3e71ac4/login" : "/login",
    );
  };

  return (
    <nav className="bg-slate-900 text-white sticky top-0 z-50">
      <div className="max-w-3xl mx-auto flex items-center justify-between h-12 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="p-2 -ml-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="メニューを開く"
            aria-expanded={menuOpen}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href={isAdmin ? "/admin" : "/submit"} className="flex items-center" onClick={() => setMenuOpen(false)}>
            <Image
              src="/logo/Niipo.svg"
              alt="Niipo"
              width={100}
              height={20}
              className="h-6 w-auto"
              priority
            />
          </Link>
        </div>

        <Link
          href="/me"
          className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
          onClick={() => setMenuOpen(false)}
        >
          {mounted && <span className="text-xs max-w-[120px] truncate">{driver?.name}</span>}
          <span className="text-slate-500">プロフィール</span>
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </Link>
      </div>

      {/* ハンバーガーメニュー オーバーレイ */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 top-12"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 right-0 top-12 z-50 bg-slate-900 border-b border-slate-700 shadow-xl">
            <div className="max-w-3xl mx-auto py-2 px-4">
              {!isAdmin && (
                <>
                  <Link
                    href="/submit"
                    className="flex items-center gap-3 py-3 px-2 text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <span>送信</span>
                  </Link>
                  <Link
                    href="/me"
                    className="flex items-center gap-3 py-3 px-2 text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <span>履歴・プロフィール</span>
                  </Link>
                  <Link
                    href="/shifts"
                    className="flex items-center gap-3 py-3 px-2 text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <span>シフト</span>
                  </Link>
                </>
              )}
              {isAdmin && (
                <>
                  <Link
                    href="/admin"
                    className="flex items-center gap-3 py-3 px-2 text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <span>日別</span>
                  </Link>
                  <Link
                    href="/admin/monthly"
                    className="flex items-center gap-3 py-3 px-2 text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <span>月次</span>
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center gap-3 py-3 px-2 text-left text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg transition-colors border-t border-slate-700 mt-2 pt-3"
              >
                <span>ログアウト</span>
              </button>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
