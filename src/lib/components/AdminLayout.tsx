"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAuth, getStoredDriver } from "@/lib/api";

const navItems = [
  { href: "/admin", label: "日別一覧" },
  { href: "/admin/monthly", label: "月次集計" },
  { href: "/admin/shifts", label: "シフト管理" },
  { href: "/admin/users", label: "ユーザー管理" },
  { href: "/admin/courses", label: "コース管理" },
  { href: "/admin/vehicles", label: "車両管理" },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [driver, setDriver] = useState<{ id: string; name: string; role: string } | null>(null);

  useEffect(() => {
    setDriver(getStoredDriver());
  }, []);

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-white flex flex-col shrink-0">
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-slate-700">
          <span className="text-lg font-semibold tracking-tight">日報集計</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-y-auto">
          <ul className="space-y-0.5 px-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-3 py-2 rounded text-sm transition-colors ${
                      isActive
                        ? "bg-slate-700 text-white font-medium"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">{driver?.name}</p>
              <p className="text-xs text-slate-500">管理者</p>
            </div>
            <button
              onClick={logout}
              className="text-xs px-2.5 py-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
