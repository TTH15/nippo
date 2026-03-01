"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartLine,
  faUsers,
  faCar,
  faRoute,
  faFileInvoice,
  faAddressBook,
  faCalendar,
  faClipboardList,
  faFileLines,
  faListUl,
  faPlus,
  faRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { clearAuth, getStoredDriver } from "@/lib/api";
import { getCompany } from "@/config/companies";
import { canAdminWrite, isAdminViewerRole } from "@/lib/authz";

type NavChild = { href: string; label: string; icon?: IconDefinition };
type NavItem =
  | { href: string; label: string; icon?: IconDefinition; children?: undefined }
  | { label: string; icon?: IconDefinition; children: NavChild[]; href?: undefined };

const navItems: NavItem[] = [
  {
    label: "売上",
    icon: faChartLine,
    children: [
      { href: "/admin/sales?tab=analytics", label: "アナリティクス", icon: faChartLine },
      { href: "/admin/sales?tab=summary", label: "集計", icon: faFileLines },
      { href: "/admin/sales?tab=log", label: "ログ", icon: faListUl },
    ],
  },
  { href: "/admin/daily", label: "日報集計", icon: faClipboardList },
  {
    label: "ドライバー",
    icon: faUsers,
    children: [
      { href: "/admin/users", label: "ドライバー管理", icon: faUsers },
      { href: "/admin/shifts", label: "シフト", icon: faCalendar },
    ],
  },
  { href: "/admin/vehicles", label: "車両", icon: faCar },
  { href: "/admin/courses", label: "コース", icon: faRoute },
  {
    label: "請求書",
    icon: faFileInvoice,
    children: [
      { href: "/admin/invoices", label: "登録済情報から作成", icon: faFileLines },
      { href: "/admin/invoices/new", label: "新規作成", icon: faPlus },
      { href: "/admin/invoices/addressbook", label: "アドレス帳", icon: faAddressBook },
    ],
  },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [driver, setDriver] = useState<{ id: string; name: string; role: string } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const company = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);
  const canWrite = canAdminWrite(driver?.role);
  const isViewer = isAdminViewerRole(driver?.role);

  useEffect(() => {
    setDriver(getStoredDriver());
  }, []);

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  const isActive = (href: string) => {
    const path = href.split("?")[0];
    return pathname === path || pathname.startsWith(path + "/");
  };

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
      {/* Sidebar（フライアウトが車両カード等の上に表示されるようz-indexを設定） */}
      <aside className="z-50 w-56 bg-slate-900 text-white flex flex-col shrink-0 h-screen sticky top-0" style={{ overflow: "visible" }}>
        {/* Logo */}
        <div className="h-20 flex items-center border-b border-slate-700/60 p-2">
          <Link href="/admin" className="inline-flex items-center">
            <Image
              src={"/logo/Nippo.svg"}
              alt="Nippo"
              width={150}
              height={50}
              className="h-20 w-auto"
              priority
            />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3" style={{ overflow: "visible" }}>
          <ul className="space-y-0.5 px-2" style={{ overflow: "visible" }}>
            {navItems.map((item) => {
              if (item.children) {
                const filteredChildren = canWrite
                  ? item.children
                  : item.children.filter((c) => c.href !== "/admin/invoices/new");
                const hasActiveChild = filteredChildren.some((c) => isActive(c.href));
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
                      <span className="flex items-center gap-2">
                        {item.icon && <FontAwesomeIcon icon={item.icon} className="w-3.5 h-3.5 opacity-90" />}
                        {item.label}
                      </span>
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
                          {filteredChildren.map((child) => {
                            const childActive = isActive(child.href);
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={() => setOpenMenu(null)}
                                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold transition-colors ${childActive
                                  ? "bg-slate-700 text-white"
                                  : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
                                  }`}
                              >
                                {child.icon && <FontAwesomeIcon icon={child.icon} className="w-3.5 h-3.5 opacity-90" />}
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
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${active
                      ? "bg-slate-700/80 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                  >
                    {item.icon && <FontAwesomeIcon icon={item.icon} className="w-3.5 h-3.5 opacity-90" />}
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
              <p className="text-[11px] text-slate-400 font-medium">
                {company.name}{isViewer ? "（閲覧）" : ""}
              </p>
            </div>
            <button
              onClick={logout}
              className="px-2.5 py-1 rounded-md font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="ログアウト"
            >
              <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="relative z-0 flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
