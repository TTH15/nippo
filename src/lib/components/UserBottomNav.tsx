"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faCalendarDays,
  faPaperPlane,
  faGift,
  faGear,
} from "@fortawesome/free-solid-svg-icons";

const TABS = [
  { href: "/me", label: "マイページ", icon: faUser },
  { href: "/shifts", label: "シフト", icon: faCalendarDays },
  { href: "/submit", label: "日報送信", icon: faPaperPlane },
  { href: "/me/rewards", label: "報酬", icon: faGift },
  { href: "/me?tab=settings", label: "設定", icon: faGear },
] as const;

export function UserBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");

  const checkActive = (href: string) => {
    if (href === "/me?tab=settings") {
      return pathname === "/me" && tabParam === "settings";
    }
    if (href === "/me") {
      return pathname === "/me" && tabParam !== "settings";
    }
    if (href === "/me/rewards") {
      return pathname === "/me/rewards";
    }
    return pathname === href;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 safe-area-inset-bottom"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
      aria-label="メインメニュー"
    >
      <div className="max-w-2xl mx-auto flex items-stretch h-14">
        {TABS.map((tab) => {
          const active = checkActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-0 transition-colors ${
                active
                  ? "text-brand-800 font-semibold"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <FontAwesomeIcon
                icon={tab.icon}
                className={`w-5 h-5 flex-shrink-0 ${active ? "text-brand-800" : "text-slate-500"}`}
                aria-hidden
              />
              <span className="text-[10px] leading-tight truncate max-w-full px-0.5">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
