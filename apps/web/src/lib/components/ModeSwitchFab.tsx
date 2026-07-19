"use client";

// 運営⇄ドライバー画面を切り替えるフローティングボタン（スマホ幅のみ表示）。
// PC は運営画面専用のため md 以上では出さない。運営権限（ADMIN / ADMIN_VIEWER）
// を持つユーザーにだけ表示する。ボタン色は「行き先モードの背景色」で、
// 押すとその色のインクが広がって切り替わる（ModeTransition 参照）。
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faTruck } from "@fortawesome/free-solid-svg-icons";
import { getStoredDriver } from "@/lib/api";
import { canAdminRead } from "@/lib/authz";
import { useModeTransition } from "./ModeTransition";

const MODES = {
  // 運営画面に居る → ドライバー画面（ライト）へ
  admin: {
    targetHref: "/submit",
    targetColorVar: "--mode-driver-bg",
    label: "ドライバー画面",
    icon: faTruck,
    buttonClass:
      "bg-slate-50 text-slate-800 border border-slate-300 bottom-[calc(var(--bottom-nav-safe-space)+16px)]",
  },
  // ドライバー画面に居る → 運営画面（ダーク）へ。下部タブと重ならない位置に置く
  driver: {
    targetHref: "/admin",
    targetColorVar: "--mode-admin-bg",
    label: "運営画面",
    icon: faChartLine,
    buttonClass:
      "bg-brand-800 text-white border border-brand-700 bottom-[calc(var(--bottom-nav-total-height)+16px)]",
  },
} as const;

export function ModeSwitchFab({ mode }: { mode: keyof typeof MODES }) {
  const { switchMode } = useModeTransition();
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setVisible(canAdminRead(getStoredDriver()?.role));
  }, []);

  if (!visible) return null;

  const conf = MODES[mode];

  const handleClick = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 48;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight - 48;
    const color =
      getComputedStyle(document.documentElement)
        .getPropertyValue(conf.targetColorVar)
        .trim() || "#f8fafc";
    switchMode({ x, y, color, href: conf.targetHref });
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      className={`md:hidden fixed right-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-[13px] font-bold shadow-lg active:scale-95 transition-transform ${conf.buttonClass}`}
      aria-label={`${conf.label}へ切り替え`}
    >
      <FontAwesomeIcon icon={conf.icon} className="w-4 h-4" aria-hidden />
      {conf.label}
    </button>
  );
}
