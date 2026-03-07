"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faCalendarDays,
  faPaperPlane,
  faGift,
  faClockRotateLeft,
} from "@fortawesome/free-solid-svg-icons";

const TABS = [
  { href: "/me", label: "マイページ", icon: faUser },
  { href: "/shifts", label: "シフト", icon: faCalendarDays },
  { href: "/submit", label: "日報送信", icon: faPaperPlane },
  { href: "/me/rewards", label: "報酬", icon: faGift },
  { href: "/me?tab=history", label: "履歴", icon: faClockRotateLeft },
] as const;

export function UserBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");

  const checkActive = (href: string) => {
    if (href === "/me?tab=history") {
      return pathname === "/me" && tabParam === "history";
    }
    if (href === "/me") {
      return pathname === "/me" && tabParam !== "history";
    }
    if (href === "/me/rewards") {
      return pathname === "/me/rewards";
    }
    return pathname === href;
  };

  const CENTER_INDEX = 2; // 日報送信

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 safe-area-inset-bottom"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
      aria-label="メインメニュー"
    >
      <div className="max-w-2xl mx-auto flex items-end h-16">
        {TABS.map((tab, index) => {
          const active = checkActive(tab.href);
          const isCenter = index === CENTER_INDEX;

          if (isCenter) {
            return (
              <div key={tab.href} className="flex-1 flex justify-center items-end min-w-0 pb-1">
                <Link
                  href={tab.href}
                  prefetch
                  className="flex flex-col items-center justify-end transition-opacity hover:opacity-90 active:opacity-95"
                  aria-current={active ? "page" : undefined}
                >
                  {/* 中央の目立つ円形ボタン（PayPay風：色付き・浮き上がり） */}
                  <div className="flex flex-col items-center justify-center flex-shrink-0 w-16 h-16 mb-3 rounded-full bg-brand-800 text-white">
                    <FontAwesomeIcon
                      icon={tab.icon}
                      className="w-7 h-7 flex-shrink-0"
                      aria-hidden
                    />
                    <span
                      className={`text-[10px] leading-tight font-semibold truncate max-w-full px-0.5 mt-1 text-white`}
                    >
                      {tab.label}
                    </span>
                  </div>
                </Link>
              </div>
            );
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-0 pb-2 pt-2 transition-colors ${active
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
