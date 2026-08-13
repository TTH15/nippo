"use client";

import { useEffect, useLayoutEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartLine,
  faChartColumn,
  faUsers,
  faCar,
  faRoute,
  faTruck,
  faFileInvoice,
  faAddressBook,
  faCalendar,
  faClock,
  faFileLines,
  faListUl,
  faRightFromBracket,
  faMoneyBill1Wave,
  faBuilding,
  faTrophy,
  faMobileScreenButton,
  faGear,
  faUserPlus,
  faUserShield,
  faLock,
  faBell,
  faMapLocationDot,
  faBriefcase,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { clearAuth, getStoredDriver, type StoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { getCompany } from "@/config/companies";
import { canAdminWrite, isAdminViewerRole } from "@/lib/authz";
import { ModeSwitchFab } from "@/lib/components/ModeSwitchFab";

// cap: そのメニューの閲覧に必要な capability（各ページの主要 API の requirePermission と対応）。
// 持っていない場合はロック表示（グレー＋鍵）にして「アクセスできない」ことを明示する。
// beta: 試験提供中の機能。ラベル横に「β」バッジを表示する。
type NavChild = { href: string; label: string; icon?: IconDefinition; cap?: string; beta?: boolean };
type NavItem =
  | { href: string; label: string; icon?: IconDefinition; cap?: string; beta?: boolean; children?: undefined }
  | { label: string; icon?: IconDefinition; children: NavChild[]; href?: undefined; cap?: undefined; beta?: undefined };

const navItems: NavItem[] = [
  { href: "/admin", label: "ダッシュボード", icon: faChartLine, cap: "can_view_reports" },
  { href: "/admin/daily", label: "報告", icon: faFileLines, cap: "can_view_reports" },
  { href: "/admin/attendance", label: "勤怠", icon: faClock, cap: "can_view_vehicles", beta: true },
  { href: "/admin/shifts", label: "シフト", icon: faCalendar, cap: "can_view_shifts" },
  { href: "/admin/spot-jobs", label: "単発案件", icon: faBriefcase, cap: "can_view_shifts", beta: true },
  { href: "/admin/vehicles", label: "車両", icon: faCar, cap: "can_view_vehicles" },
  { href: "/admin/map", label: "地図", icon: faMapLocationDot, cap: "can_view_vehicles", beta: true },
  {
    label: "収支",
    icon: faFileInvoice,
    children: [
      { href: "/admin/sales", label: "売上", icon: faChartColumn, cap: "can_view_billing" },
      { href: "/admin/payments", label: "ペイメント", icon: faMoneyBill1Wave, cap: "can_view_rewards" },
      { href: "/admin/invoices", label: "請求書", icon: faAddressBook, cap: "can_view_billing" },
      { href: "/admin/adjustments", label: "調整履歴", icon: faListUl, cap: "can_view_billing" },
    ],
  },
  {
    label: "ドライバー",
    icon: faUsers,
    children: [
      { href: "/admin/users/pending", label: "参加・承認", icon: faUserPlus, cap: "can_approve_members" },
      { href: "/admin/users", label: "ドライバー一覧", icon: faUsers, cap: "can_view_members" },
    ],
  },
  { href: "/admin/events", label: "イベント", icon: faTrophy, cap: "can_view_org_settings" },
  { href: "/admin/notifications", label: "通知配信", icon: faBell, cap: "can_send_notifications", beta: true },
  {
    label: "設定",
    icon: faGear,
    children: [
      { href: "/admin/roles", label: "ロール・権限", icon: faUserShield, cap: "can_view_members" },
      { href: "/admin/carriers", label: "キャリア／フォーム設計", icon: faTruck, cap: "can_view_org_settings" },
      { href: "/admin/courses", label: "コース／単価表", icon: faRoute, cap: "can_view_org_settings" },
      { href: "/admin/counterparties", label: "取引先", icon: faBuilding, cap: "can_view_billing" },
      { href: "/admin/report-kinds", label: "報告種別", icon: faFileLines, cap: "can_view_org_settings" },
      { href: "/admin/submit-screen", label: "送信後画面", icon: faMobileScreenButton, cap: "can_view_org_settings" },
    ],
  },
];

// 試験提供中バッジ。ラベルの直後に置く。
function BetaBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-bold leading-none text-violet-700">
      β
    </span>
  );
}

// ロック済みメニュー行（クリック不可）。「権限が無い＝そもそも開けない」ことを見せる。
function LockedNavRow({ label, icon }: { label: string; icon?: IconDefinition }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-bold text-slate-300 cursor-not-allowed select-none"
      title="このロールには権限がありません"
      aria-disabled
    >
      {icon && <FontAwesomeIcon icon={icon} className="w-3.5 h-3.5 opacity-60" />}
      {label}
      <span className="ml-auto flex items-center gap-2">
        <FontAwesomeIcon icon={faLock} className="w-3 h-3 opacity-70" />
      </span>
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // 要対応件数は SWR でグローバルにキャッシュする。ページ遷移で AdminLayout が
  // 再マウントされても前回値が即返るため、バッジが一瞬消えない。60秒ごとに自動更新。
  const dailyUnreadApi = useApi<{ unreadCount: number }>("/api/admin/daily/unread-count", {
    refreshInterval: 60000,
  });
  const otherUnreadApi = useApi<{ unreadCount: number }>(
    "/api/admin/misc-reports/oil-change/unread-count",
    { refreshInterval: 60000 },
  );
  const oilAlertApi = useApi<{ count: number }>("/api/admin/vehicles/oil-alert-count", {
    refreshInterval: 60000,
  });
  const licenseAlertApi = useApi<{ count: number }>("/api/admin/users/license-alert-count", {
    refreshInterval: 60000,
  });
  const pendingApprovalApi = useApi<{ count: number }>("/api/admin/users/pending-count", {
    refreshInterval: 60000,
  });
  const dailyUnreadCount = Number(dailyUnreadApi.data?.unreadCount) || 0;
  const otherUnreadCount = Number(otherUnreadApi.data?.unreadCount) || 0;
  // オイル交換が迫っている車両の台数（「管理」メニューに通知バッジで表示）
  const oilAlertCount = Number(oilAlertApi.data?.count) || 0;
  // 免許更新が迫っているドライバーの人数（「管理」「ドライバー」メニューに通知バッジで表示）
  const licenseAlertCount = Number(licenseAlertApi.data?.count) || 0;
  // 参加承認待ちの申請件数（「ドライバー」→「参加・承認」に通知バッジで表示）
  const pendingApprovalCount = Number(pendingApprovalApi.data?.count) || 0;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const company = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);
  const canWrite = canAdminWrite(driver?.role);
  const isViewer = isAdminViewerRole(driver?.role);
  // メニューのロック判定。capabilities 未取得（旧セッション・読込前）のときはロックしない
  //（誤ロックを避ける。最終的な防壁はサーバー側の requirePermission 403）。
  const capList = driver?.capabilities;
  const isLocked = (cap?: string) => Array.isArray(capList) && !!cap && !capList.includes(cap);

  useEffect(() => {
    setDriver(getStoredDriver());
  }, []);

  // モバイルヘッダーの実高さを CSS 変数へ公開する。ページ側の sticky ツールバーは
  // top: var(--admin-header-h) で貼り付けるため、端末差・フォント差でズレない
  // （PC ではヘッダーが非表示＝高さ 0 になり、そのままページ上端に貼り付く）。
  const mobileHeaderRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = mobileHeaderRef.current;
    const apply = () => {
      const h = el?.getBoundingClientRect().height ?? 0;
      document.documentElement.style.setProperty("--admin-header-h", `${Math.round(h)}px`);
    };
    apply();
    if (!el || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  // ページ遷移時に最新化（キャッシュ値は保持したまま裏で再検証するのでバッジは消えない）。
  useEffect(() => {
    void dailyUnreadApi.mutate();
    void otherUnreadApi.mutate();
    void oilAlertApi.mutate();
    void licenseAlertApi.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  const isActive = (href: string) => {
    const path = href.split("?")[0];
    // ダッシュボード(/admin)は全ページが "/admin/..." で始まるため、前方一致だと
    // 常にアクティブ扱いになってしまう。ルートのみ完全一致で判定する。
    if (path === "/admin") return pathname === "/admin";
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

  // クリックはフライアウトのトグル（タッチでも開ける）。ホバーは従来どおり補助的に開く。
  const handleParentClick = (item: Extract<NavItem, { children: NavChild[] }>) => {
    clearHideTimer();
    setOpenMenu((cur) => (cur === item.label ? null : item.label));
  };

  const getChildUnreadCount = (href: string) => {
    if (href === "/admin/daily") return dailyUnreadCount;
    if (href === "/admin/misc-reports/others") return otherUnreadCount;
    if (href === "/admin/vehicles") return oilAlertCount;
    if (href === "/admin/users") return licenseAlertCount;
    if (href === "/admin/users/pending") return pendingApprovalCount;
    return 0;
  };

  const getParentUnreadCount = (item: Extract<NavItem, { children: NavChild[] }>) => {
    // 「ドライバー」配下の要対応件数（参加承認待ち＋免許更新警告）を通知バッジで表示。
    // （オイル交換警告はトップレベルの「車両」リンク側に getChildUnreadCount で直接表示）
    if (item.label === "ドライバー") return licenseAlertCount + pendingApprovalCount;
    return 0;
  };

  useEffect(() => {
    return () => clearHideTimer();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 max-md:bg-transparent">
      {/* モバイルヘッダー（運営モードの外枠。ダークで「運営に居る」ことを示す） */}
      {/* z-40: ページ内の sticky テーブルヘッダー（z-20〜30）より前面に置き、スクロール時の重なりを防ぐ */}
      {/* 高さは実測して --admin-header-h に公開する（ページ側の sticky がこの値で貼り付く） */}
      <header
        ref={mobileHeaderRef}
        className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 px-3 border-b border-brand-700 bg-brand-800/95 backdrop-blur shadow-sm md:hidden"
      >
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="inline-flex flex-col items-center justify-center w-9 h-9 rounded-md border border-brand-600 bg-brand-700"
          aria-label="メニューを開く"
        >
          <span className="sr-only">メニュー</span>
          <span className="block w-4 h-0.5 bg-slate-100 rounded-sm" />
          <span className="block w-4 h-0.5 bg-slate-100 rounded-sm mt-1" />
          <span className="block w-4 h-0.5 bg-slate-100 rounded-sm mt-1" />
        </button>
        {/* ロゴは濃色の塗りを含むため、ダークヘッダーでは白チップに載せて視認性を保つ */}
        <Link href="/admin" className="inline-flex items-center rounded-lg bg-white px-1.5">
          <Image
            src={"/logo/hakotora-logo_secondary_logo.svg"}
            alt="ハコ虎"
            width={120}
            height={40}
            className="h-9 w-auto"
            priority
          />
        </Link>
        <button
          onClick={logout}
          className="px-2.5 py-1 rounded-md font-bold text-slate-300 hover:text-white"
          title="ログアウト"
        >
          <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar（デスクトップ常時表示） */}
        <aside
          className="hidden md:flex z-40 w-56 bg-white text-slate-700 border-r border-slate-200 flex-col shrink-0 h-screen sticky top-0"
          style={{ overflow: "visible" }}
        >
          {/* Logo */}
          <div className="h-20 flex items-center border-b border-slate-200 p-2">
            <Link href="/admin" className="inline-flex items-center">
              <Image
                src={"/logo/hakotora-logo_primary_logo.svg"}
                alt="ハコ虎"
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
                  const unlockedChildren = filteredChildren.filter((c) => !isLocked(c.cap));
                  // 配下すべてに権限が無ければ親ごとロック（フライアウトも開かない）
                  if (unlockedChildren.length === 0) {
                    return (
                      <li key={item.label}>
                        <LockedNavRow label={item.label} icon={item.icon} />
                      </li>
                    );
                  }
                  const hasActiveChild = unlockedChildren.some((c) => isActive(c.href));
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
                        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${hasActiveChild || isOpen
                            ? "bg-amber-100 text-amber-800"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                      >
                        {item.icon && (
                          <FontAwesomeIcon icon={item.icon} className="w-3.5 h-3.5 opacity-90" />
                        )}
                        {item.label}
                        {/* バッジは右端の chevron 列の左隣に固定（全項目で横位置を統一） */}
                        <span className="ml-auto flex items-center gap-2">
                          {getParentUnreadCount(item) > 0 && (
                            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums">
                              {getParentUnreadCount(item)}
                            </span>
                          )}
                          <svg
                            className="w-3 h-3 opacity-50"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2.5}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </span>
                      </button>

                      {/* フライアウトパネル */}
                      {isOpen && (
                        <div
                          className="absolute left-full top-0 ml-1"
                          style={{ zIndex: 9999 }}
                          onMouseEnter={handlePanelEnter}
                          onMouseLeave={handlePanelLeave}
                        >
                          <div className="bg-white rounded-lg shadow-2xl border border-slate-200 py-1.5 min-w-[200px]">
                            {filteredChildren.map((child) => {
                              if (isLocked(child.cap)) {
                                return (
                                  <div
                                    key={child.href}
                                    className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold text-slate-300 cursor-not-allowed select-none"
                                    title="このロールには権限がありません"
                                    aria-disabled
                                  >
                                    {child.icon && (
                                      <FontAwesomeIcon icon={child.icon} className="w-3.5 h-3.5 opacity-60" />
                                    )}
                                    {child.label}
                                    <FontAwesomeIcon icon={faLock} className="ml-auto w-3 h-3 opacity-70" />
                                  </div>
                                );
                              }
                              const childActive = isActive(child.href);
                              return (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  onClick={() => setOpenMenu(null)}
                                  className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold transition-colors ${childActive
                                      ? "bg-amber-100 text-amber-800"
                                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                    }`}
                                >
                                  {child.icon && (
                                    <FontAwesomeIcon
                                      icon={child.icon}
                                      className="w-3.5 h-3.5 opacity-90"
                                    />
                                  )}
                                  {child.label}
                                  {child.beta && <BetaBadge />}
                                  {getChildUnreadCount(child.href) > 0 && (
                                    <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums">
                                      {getChildUnreadCount(child.href)}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                }

                if (isLocked(item.cap)) {
                  return (
                    <li key={item.href}>
                      <LockedNavRow label={item.label} icon={item.icon} />
                    </li>
                  );
                }
                const active = isActive(item.href);
                const linkUnread = getChildUnreadCount(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${active
                          ? "bg-amber-100 text-amber-800"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                      {item.icon && (
                        <FontAwesomeIcon icon={item.icon} className="w-3.5 h-3.5 opacity-90" />
                      )}
                      {item.label}
                      {item.beta && <BetaBadge />}
                      {/* chevron を持たないリンクも、同じ幅のスペーサーでバッジ右端を親項目と揃える */}
                      <span className="ml-auto flex items-center gap-2">
                        {linkUnread > 0 && (
                          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums">
                            {linkUnread}
                          </span>
                        )}
                        <span className="w-3" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <Link href="/admin/account" className="min-w-0 hover:opacity-70 transition-opacity">
                <p className="text-sm font-bold text-slate-900 truncate">{driver?.name}</p>
                <p className="text-[11px] text-slate-500 font-medium">
                  {company.name}
                  {isViewer ? "（閲覧）" : ""}
                </p>
              </Link>
              <button
                onClick={logout}
                className="px-2.5 py-1 rounded-md font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                title="ログアウト"
              >
                <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* モバイル用ドロワーナビ。常時マウントし、開閉ともスライド＋フェードで滑らかに動かす
            （条件付きマウントだと初期状態が無く transition が効かない） */}
        <div
          className={`fixed inset-0 z-50 md:hidden ${mobileNavOpen ? "" : "pointer-events-none"}`}
          aria-hidden={!mobileNavOpen}
        >
          <button
            type="button"
            tabIndex={mobileNavOpen ? 0 : -1}
            className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out ${
              mobileNavOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setMobileNavOpen(false)}
            aria-label="メニューを閉じる"
          />
          <aside
            className={`absolute right-0 top-0 h-full w-64 max-w-[80%] bg-white text-slate-700 flex flex-col shadow-2xl transition-transform duration-300 ease-out will-change-transform ${
              mobileNavOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
              <div className="h-16 flex items-center justify-between border-b border-slate-200 px-3">
                <Link
                  href="/admin"
                  className="inline-flex items-center"
                  onClick={() => setMobileNavOpen(false)}
                >
                  <Image
                    src={"/logo/hakotora-logo_secondary_logo.svg"}
                    alt="ハコ虎"
                    width={130}
                    height={40}
                    className="h-10 w-auto"
                    priority
                  />
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  aria-label="メニューを閉じる"
                >
                  ×
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto py-3">
                <ul className="space-y-0.5 px-2">
                  {navItems.map((item) => {
                    if (item.children) {
                      const filteredChildren = canWrite
                        ? item.children
                        : item.children.filter((c) => c.href !== "/admin/invoices/new");
                      const unlockedChildren = filteredChildren.filter((c) => !isLocked(c.cap));
                      // 配下すべてに権限が無ければ見出しごとロック表示
                      if (unlockedChildren.length === 0) {
                        return (
                          <li key={item.label}>
                            <LockedNavRow label={item.label} icon={item.icon} />
                          </li>
                        );
                      }
                      return (
                        <li key={item.label}>
                          <p className="px-3 py-2.5 text-[12px] font-bold text-slate-500 uppercase tracking-wide">
                            <span className="inline-flex items-center gap-2">
                              {item.label}
                              {getParentUnreadCount(item) > 0 && (
                                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums normal-case">
                                  {getParentUnreadCount(item)}
                                </span>
                              )}
                            </span>
                          </p>
                          <ul className="mb-1">
                            {filteredChildren.map((child) => {
                              if (isLocked(child.cap)) {
                                return (
                                  <li key={child.href}>
                                    <div
                                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium text-slate-300 cursor-not-allowed select-none"
                                      title="このロールには権限がありません"
                                      aria-disabled
                                    >
                                      {child.icon && (
                                        <FontAwesomeIcon icon={child.icon} className="w-3.5 h-3.5 opacity-60" />
                                      )}
                                      {child.label}
                                      <FontAwesomeIcon icon={faLock} className="ml-auto w-3 h-3 opacity-70" />
                                    </div>
                                  </li>
                                );
                              }
                              const active = isActive(child.href);
                              return (
                                <li key={child.href}>
                                  <Link
                                    href={child.href}
                                    onClick={() => setMobileNavOpen(false)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium ${active
                                        ? "bg-amber-100 text-amber-800"
                                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                      }`}
                                  >
                                    {child.icon && (
                                      <FontAwesomeIcon
                                        icon={child.icon}
                                        className="w-3.5 h-3.5 opacity-90"
                                      />
                                    )}
                                    {child.label}
                                    {child.beta && <BetaBadge />}
                                    {getChildUnreadCount(child.href) > 0 && (
                                      <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums">
                                        {getChildUnreadCount(child.href)}
                                      </span>
                                    )}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      );
                    }
                    if (isLocked(item.cap)) {
                      return (
                        <li key={item.href}>
                          <LockedNavRow label={item.label} icon={item.icon} />
                        </li>
                      );
                    }
                    const active = isActive(item.href);
                    const linkUnread = getChildUnreadCount(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setMobileNavOpen(false)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-bold ${active
                              ? "bg-amber-100 text-amber-800"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            }`}
                        >
                          {item.icon && (
                            <FontAwesomeIcon icon={item.icon} className="w-3.5 h-3.5 opacity-90" />
                          )}
                          {item.label}
                          {item.beta && <BetaBadge />}
                          {linkUnread > 0 && (
                            <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums">
                              {linkUnread}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <div className="p-4 border-t border-slate-200 text-sm text-slate-600">
                <Link href="/admin/account" onClick={() => setMobileNavOpen(false)} className="block mb-2">
                  <p className="font-bold">{driver?.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {company.name}
                    {isViewer ? "（閲覧）" : ""}
                  </p>
                </Link>
                <button
                  onClick={logout}
                  className="w-full mt-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-slate-100 text-slate-800 hover:bg-slate-200 text-sm font-semibold"
                >
                  <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
                  ログアウト
                </button>
              </div>
            </aside>
        </div>

        {/* Main content。スマホ幅ではダークな外枠の上に載るライトのシートにする
            （既存 admin ページの配色を変えずにモード識別色を成立させるため） */}
        <main className="relative flex-1 overflow-auto max-md:mt-1.5 max-md:rounded-t-2xl max-md:bg-slate-50">
          <div className="px-3 py-4 md:p-6">{children}</div>
        </main>
      </div>
      {/* スマホ幅のみ: ドライバー画面への切替 FAB（旧サイドバー/ドロワーのリンクを置換） */}
      <ModeSwitchFab mode="admin" />
    </div>
  );
}
