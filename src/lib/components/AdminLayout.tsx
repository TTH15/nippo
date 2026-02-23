"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAuth, getStoredDriver } from "@/lib/api";

type NavChild = { href: string; label: string };
type NavItem =
  | { href: string; label: string; children?: undefined }
  | { label: string; children: NavChild[]; href?: undefined };

const navItems: NavItem[] = [
  { href: "/admin/sales", label: "売上" },
  {
    label: "ドライバー",
    children: [
      { href: "/admin/users", label: "ドライバー管理" },
      { href: "/admin/shifts", label: "シフト" },
    ],
  },
  { href: "/admin/vehicles", label: "車両" },
  { href: "/admin/courses", label: "コース" },
  {
    label: "請求書",
    children: [
      { href: "/admin/invoices", label: "登録済情報から作成" },
      { href: "/admin/invoices/new", label: "新規作成" },
      { href: "/admin/invoices/addressbook", label: "アドレス帳" },
    ],
  },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [driver, setDriver] = useState<{ id: string; name: string; role: string } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDriver(getStoredDriver());
  }, []);

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const startHideTimer = () => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => setOpenMenu(null), 200);
  };

  const handleParentEnter = (label: string) => {
    clearHideTimer();
    setOpenMenu(label);
  };

  const handleParentLeave = () => {
    startHideTimer();
  };

  const handlePanelEnter = () => {
    clearHideTimer();
  };

  const handlePanelLeave = () => {
    startHideTimer();
  };

  const handleParentClick = (item: Extract<NavItem, { children: NavChild[] }>) => {
    router.push(item.children[0].href);
    setOpenMenu(null);
  };

  useEffect(() => {
    return () => clearHideTimer();
  }, []);

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-white flex flex-col shrink-0 h-screen sticky top-0" style={{ overflow: "visible" }}>
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-slate-700/60">
          <span className="text-lg font-extrabold tracking-tight">日報集計</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3" style={{ overflow: "visible" }}>
          <ul className="space-y-0.5 px-2" style={{ overflow: "visible" }}>
            {navItems.map((item) => {
              if (item.children) {
                const hasActiveChild = item.children.some((c) => isActive(c.href));
                const isOpen = openMenu === item.label;

                return (
                  <li
                    key={item.label}
                    className="relative"
                    style={{ overflow: "visible" }}
                    onMouseEnter={() => handleParentEnter(item.label)}
                    onMouseLeave={handleParentLeave}
                  >
                    <button
                      type="button"
                      onClick={() => handleParentClick(item)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${hasActiveChild || isOpen
                        ? "bg-slate-700/80 text-white"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                        }`}
                    >
                      <span>{item.label}</span>
                      <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>

                    {/* フライアウトパネル */}
                    {isOpen && (
                      <div
                        className="absolute left-full top-0 ml-1"
                        style={{ zIndex: 9999 }}
                        onMouseEnter={handlePanelEnter}
                        onMouseLeave={handlePanelLeave}
                      >
                        <div className="bg-slate-800 rounded-lg shadow-2xl border border-slate-600/50 py-1.5 min-w-[200px]">
                          {item.children.map((child) => {
                            const childActive = isActive(child.href);
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={() => setOpenMenu(null)}
                                className={`block px-4 py-2.5 text-[13px] font-bold transition-colors ${childActive
                                  ? "bg-slate-700 text-white"
                                  : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
                                  }`}
                              >
                                {child.label}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                );
              }

              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-3 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${active
                      ? "bg-slate-700/80 text-white"
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
        <div className="p-4 border-t border-slate-700/60">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">{driver?.name}</p>
              <p className="text-[11px] text-slate-500 font-medium">管理者</p>
            </div>
            <button
              onClick={logout}
              className="text-[11px] px-2.5 py-1 rounded-md font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
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
