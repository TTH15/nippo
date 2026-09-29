"use client";

import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { PreviewLink as Link, PreviewImage as Image } from "./layout-adapters";
import { previewConnectionLabel } from "./mapbox-config";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faLock, faRightFromBracket, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { activeAdminNavHref, adminNavItems as navItems, type NavChild, type NavItem } from "@/lib/components/adminNavItems";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";

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

// AdminLayout.tsx の表示用JSXを複製（2026-08-31）。メニュー項目は共通定義を使う。
// 認証・API・Routerの代わりにプレビュー専用の架空データと遷移を注入する。
export type AdminPreviewLayoutProps = {
  children: React.ReactNode;
  pathname: string;
  onReset: () => void;
  /** 役割切替のあるプレビュー（scripts/previews/kernel）だけが渡す。省略時は従来どおり全権限の管理者 */
  viewer?: { name: string; role: string; capabilities: string[] };
  companyName?: string;
  /** 「プレビュー · 架空データ」行の代わりに出す説明。省略時は従来の文言 */
  noticeLabel?: string;
};

export function AdminPreviewLayout({ children, pathname, onReset, viewer, companyName, noticeLabel }: AdminPreviewLayoutProps) {
  const mainRef = useRef<HTMLElement | null>(null);
  const driver = { name: viewer?.name ?? "サンプル管理者" };
  const company = { name: companyName ?? "サンプル運送（架空）" };
  // 本番 AdminLayout と同じ判定: ADMIN 系だけ書き込み可、ADMIN_VIEWER は「（閲覧）」表示、
  // capability を持たないメニューはロック表示にする。
  const canWrite = viewer ? viewer.role === "ADMIN" : true;
  const isViewer = viewer?.role === "ADMIN_VIEWER";
  const isLocked = (cap?: string) => !!viewer && !!cap && !viewer.capabilities.includes(cap);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const dailyUnreadCount = 0;
  const otherUnreadCount = 0;
  const oilAlertCount = 0;
  const licenseAlertCount = 0;
  const pendingApprovalCount = 0;

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

  useEffect(() => {
    setOpenMenu(null); setMobileNavOpen(false);
    // 本番ではルート遷移でページが再マウントされる。状態切替のモックでも先頭へ戻す。
    if (mainRef.current) mainRef.current.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);
  // ログインしないプレビューではアカウント操作を実行しない。
  const logout = onReset;

  const isActive = (href: string) => activeAdminNavHref(pathname) === href;

  useEffect(() => {
    const activeGroup = navItems.find((item) => item.children?.some((child) =>
      pathname === child.href || pathname.startsWith(`${child.href}/`),
    ));
    setOpenMenu(activeGroup?.label ?? null);
  }, [pathname]);

  const toggleMenu = (label: string) => setOpenMenu((current) => current === label ? null : label);

  useEffect(() => {
    if (!openMenu) return;
    const timer = window.setTimeout(() => {
      const panel = document.getElementById(`${mobileNavOpen ? "admin-mobile-nav" : "admin-nav"}-${openMenu}`);
      (panel?.querySelector('[aria-current="page"]') ?? panel?.querySelector("a"))?.scrollIntoView({ block: "nearest" });
    }, 170);
    return () => window.clearTimeout(timer);
  }, [openMenu, mobileNavOpen]);

  const getChildUnreadCount = (href: string) => {
    if (href === "/admin/daily") return dailyUnreadCount;
    if (href === "/admin/misc-reports/others") return otherUnreadCount;
    if (href === "/admin/vehicles") return oilAlertCount;
    if (href === "/admin/users") return licenseAlertCount;
    if (href === "/admin/users/pending") return pendingApprovalCount;
    return 0;
  };

  const getParentUnreadCount = (item: Extract<NavItem, { children: NavChild[] }>) => {
    if (item.label === "車両") return oilAlertCount;
    if (item.label === "報告") return dailyUnreadCount + otherUnreadCount;
    if (item.label === "ドライバー") return licenseAlertCount + pendingApprovalCount;
    return 0;
  };

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
          title="プレビューを初期化"
        >
          <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar（デスクトップ常時表示） */}
        <aside
          className="hidden md:flex z-40 w-56 bg-white text-slate-700 border-r border-slate-200 flex-col shrink-0 h-screen sticky top-0 overflow-hidden"
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
          <nav aria-label="管理メニュー" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3">
            <ul className="space-y-0.5 px-2">
              {navItems.map((item) => {
                if (item.children) {
                  const filteredChildren = canWrite
                    ? item.children
                    : item.children.filter((c) => c.href !== "/admin/invoices/new");
                  const unlockedChildren = filteredChildren.filter((c) => !isLocked(c.cap));
                  // 配下すべてに権限が無ければ親ごとロック
                  if (unlockedChildren.length === 0) {
                    return (
                      <li key={item.label}>
                        <LockedNavRow label={item.label} icon={item.icon} />
                      </li>
                    );
                  }
                  const hasActiveChild = unlockedChildren.some((c) => isActive(c.href));
                  const isOpen = openMenu === item.label;
                  const panelId = `admin-nav-${item.label}`;

                  return (
                    <li key={item.label}>
                      <button
                        type="button"
                        id={`${panelId}-button`}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => toggleMenu(item.label)}
                        className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-bold transition-colors ${hasActiveChild
                          ? "bg-amber-100 text-amber-800"
                          : isOpen ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                      >
                        {item.icon && <FontAwesomeIcon icon={item.icon} className="h-3.5 w-3.5 opacity-90" />}
                        {item.label}
                        <span className="ml-auto flex items-center gap-2">
                          {getParentUnreadCount(item) > 0 && (
                            <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] leading-none text-white tabular-nums">
                              {getParentUnreadCount(item)}
                            </span>
                          )}
                          <FontAwesomeIcon icon={faChevronDown} className={`h-3 w-3 opacity-60 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`} />
                        </span>
                      </button>
                      <SmoothCollapse open={isOpen} id={panelId} labelledBy={`${panelId}-button`} speed="quick">
                        <ul className="mb-1 ml-5 border-l border-slate-200 pl-2">
                          {filteredChildren.map((child) => (
                            <li key={child.href}>
                              {isLocked(child.cap) ? <LockedNavRow label={child.label} icon={child.icon} /> : (
                                <Link
                                  href={child.href}
                                  aria-current={isActive(child.href) ? "page" : undefined}
                                  className={`flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-[12px] font-semibold transition-colors ${isActive(child.href)
                                    ? "bg-amber-50 text-amber-800"
                                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                                >
                                  {child.icon && <FontAwesomeIcon icon={child.icon} className="h-3.5 w-3.5 shrink-0 opacity-90" />}
                                  <span>{child.label}</span>
                                  {child.beta && <BetaBadge />}
                                  {getChildUnreadCount(child.href) > 0 && (
                                    <span className="ml-auto inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] leading-none text-white tabular-nums">
                                      {getChildUnreadCount(child.href)}
                                    </span>
                                  )}
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      </SmoothCollapse>
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
          <div className="shrink-0 p-4 border-t border-slate-200">
            <p className="mb-2 text-[10px] font-medium text-amber-800">{noticeLabel ?? `プレビュー · 架空データ・${previewConnectionLabel}`}</p>
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
                title="プレビューを初期化"
              >
                <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* モバイル用ドロワーナビ。常時マウントし、開閉ともスライド＋フェードで滑らかに動かす
            （条件付きマウントだと初期状態が無く transition が効かない） */}
        <div
          inert={mobileNavOpen ? undefined : true}
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
                  <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
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
                      const hasActiveChild = unlockedChildren.some((child) => isActive(child.href));
                      const isOpen = openMenu === item.label;
                      const panelId = `admin-mobile-nav-${item.label}`;
                      return (
                        <li key={item.label}>
                          <button
                            type="button"
                            id={`${panelId}-button`}
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            onClick={() => toggleMenu(item.label)}
                            className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-bold ${hasActiveChild
                              ? "bg-amber-100 text-amber-800"
                              : isOpen ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-100"}`}
                          >
                            {item.icon && <FontAwesomeIcon icon={item.icon} className="h-3.5 w-3.5" />}
                            {item.label}
                            <span className="ml-auto flex items-center gap-2">
                              {getParentUnreadCount(item) > 0 && (
                                <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] text-white tabular-nums">
                                  {getParentUnreadCount(item)}
                                </span>
                              )}
                              <FontAwesomeIcon icon={faChevronDown} className={`h-3 w-3 opacity-60 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`} />
                            </span>
                          </button>
                          <SmoothCollapse open={isOpen} id={panelId} labelledBy={`${panelId}-button`} speed="quick">
                            <ul className="mb-1 ml-5 border-l border-slate-200 pl-2">
                              {filteredChildren.map((child) => (
                                <li key={child.href}>
                                  {isLocked(child.cap) ? <LockedNavRow label={child.label} icon={child.icon} /> : (
                                    <Link
                                      href={child.href}
                                      onClick={() => setMobileNavOpen(false)}
                                      aria-current={isActive(child.href) ? "page" : undefined}
                                      className={`flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-[12px] font-semibold ${isActive(child.href)
                                        ? "bg-amber-50 text-amber-800"
                                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                                    >
                                      {child.icon && <FontAwesomeIcon icon={child.icon} className="h-3.5 w-3.5 shrink-0" />}
                                      <span>{child.label}</span>
                                      {child.beta && <BetaBadge />}
                                      {getChildUnreadCount(child.href) > 0 && (
                                        <span className="ml-auto inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] text-white tabular-nums">
                                          {getChildUnreadCount(child.href)}
                                        </span>
                                      )}
                                    </Link>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </SmoothCollapse>
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
                  プレビューを初期化
                </button>
              </div>
            </aside>
        </div>

        {/* Main content。スマホ幅ではダークな外枠の上に載るライトのシートにする
            （既存 admin ページの配色を変えずにモード識別色を成立させるため） */}
        <main ref={mainRef} className="relative flex-1 overflow-auto max-md:mt-1.5 max-md:rounded-t-2xl max-md:bg-slate-50">
          <div className="px-3 py-4 md:p-6">{children}</div>
        </main>
      </div>

    </div>
  );
}
