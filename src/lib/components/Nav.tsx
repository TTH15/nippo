"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStoredDriver, clearAuth } from "@/lib/api";

export function Nav() {
  const router = useRouter();
  const [driver, setDriver] = useState<{ id: string; name: string; role: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDriver(getStoredDriver());
    setMounted(true);
  }, []);

  const isAdmin = driver?.role === "ADMIN";

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  return (
    <nav className="bg-slate-900 text-white sticky top-0 z-50">
      <div className="max-w-3xl mx-auto flex items-center justify-between h-12 px-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-sm">日報集計</span>
          {!isAdmin && (
            <div className="flex items-center gap-4">
              <Link href="/submit" className="text-sm text-slate-300 hover:text-white transition-colors">送信</Link>
              <Link href="/me" className="text-sm text-slate-300 hover:text-white transition-colors">履歴</Link>
              <Link href="/shifts" className="text-sm text-slate-300 hover:text-white transition-colors">シフト</Link>
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center gap-4">
              <Link href="/admin" className="text-sm text-slate-300 hover:text-white transition-colors">日別</Link>
              <Link href="/admin/monthly" className="text-sm text-slate-300 hover:text-white transition-colors">月次</Link>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {mounted && <span className="text-xs text-slate-400">{driver?.name}</span>}
          <button onClick={logout} className="text-xs px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            ログアウト
          </button>
        </div>
      </div>
    </nav>
  );
}
