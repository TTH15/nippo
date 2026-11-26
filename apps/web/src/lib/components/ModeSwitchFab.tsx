"use client";

// 運営⇄ドライバー画面を切り替えるフローティングボタン（スマホ幅のみ表示）。
// PC は運営画面専用のため md 以上では出さない。運営権限（ADMIN / ADMIN_VIEWER）
// を持つユーザーにだけ表示する。ボタン色は「行き先モードの背景色」で、
// 押すとその色のインクが広がって切り替わる（ModeTransition 参照）。
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faTruck } from "@fortawesome/free-solid-svg-icons";
import { getStoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
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

type Position = { x: number; y: number };
const driverPositionKey = "hakotora-driver-mode-switch-position";
const holdMs = 500;
const dragSlop = 8;

export function ModeSwitchFab({ mode }: { mode: keyof typeof MODES }) {
  const { switchMode } = useModeTransition();
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{
    id: number; start: Position; origin: Position; timer: number; held: boolean; moved: boolean; previous: Position | null;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (mode !== "driver") return;
    try {
      const saved = JSON.parse(localStorage.getItem(driverPositionKey) ?? "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) setPosition({ x: saved.x, y: saved.y });
    } catch { /* Storage is optional. */ }
    return () => { if (press.current) window.clearTimeout(press.current.timer); };
  }, [mode]);

  function cancelPress() {
    const active = press.current;
    if (!active) return;
    window.clearTimeout(active.timer);
    suppressClick.current = true;
    press.current = null;
    if (active.moved) setPosition(active.previous);
    setDragging(false);
  }

  function startPress(e: PointerEvent<HTMLButtonElement>) {
    if (!e.isPrimary || e.button !== 0) { cancelPress(); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    suppressClick.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = {
      id: e.pointerId, start: { x: e.clientX, y: e.clientY }, origin: { x: rect.left, y: rect.top },
      previous: position, held: false, moved: false,
      timer: window.setTimeout(() => {
        if (!press.current) return;
        press.current.held = true;
        suppressClick.current = true;
        setDragging(true);
      }, holdMs),
    };
  }

  function movePress(e: PointerEvent<HTMLButtonElement>) {
    const active = press.current;
    if (!active || active.id !== e.pointerId) return;
    const dx = e.clientX - active.start.x, dy = e.clientY - active.start.y;
    if (!active.held) {
      if (Math.hypot(dx, dy) > dragSlop) cancelPress();
      return;
    }
    if (!dx && !dy && !active.moved) return;
    active.moved = true;
    setPosition({ x: active.origin.x + dx, y: active.origin.y + dy });
  }

  function endPress(e: PointerEvent<HTMLButtonElement>) {
    const active = press.current;
    if (!active || active.id !== e.pointerId) return;
    window.clearTimeout(active.timer);
    press.current = null;
    setDragging(false);
    if (!active.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const settled = { x: rect.left, y: rect.top };
    setPosition(settled);
    try { localStorage.setItem(driverPositionKey, JSON.stringify(settled)); } catch { /* Keep the in-memory position. */ }
  }

  useEffect(() => {
    // capability を1つでも持つ = 運営画面に入れるアカウント（(admin) 入口ガードと同一判定）
    setVisible(canEnterAdmin(getStoredDriver()));
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
      data-mode-switch={mode}
      ref={buttonRef}
      type="button"
      data-positioned={mode === "driver" && position ? "" : undefined}
      style={mode === "driver" && position ? { "--fab-x": `${position.x}px`, "--fab-y": `${position.y}px` } as CSSProperties : undefined}
      {...(mode === "driver" ? {
        onPointerDown: startPress, onPointerMove: movePress, onPointerUp: endPress,
        onPointerCancel: cancelPress, onLostPointerCapture: cancelPress,
        onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
        "aria-description": "長押しして移動",
      } : {})}
      onClick={e => {
        if (mode === "driver" && e.detail > 0 && suppressClick.current) return;
        handleClick();
      }}
      className={`md:hidden fixed right-4 z-40 flex items-center justify-center rounded-full font-bold shadow-lg ${mode === "driver" ? `h-11 w-11 touch-none select-none [-webkit-touch-callout:none] ${dragging ? "cursor-grabbing ring-2 ring-amber-500" : "cursor-pointer"}` : "gap-2 px-4 py-3 text-[13px] active:scale-95 transition-transform"} ${conf.buttonClass}`}
      aria-label={`${conf.label}へ切り替え`}
    >
      <FontAwesomeIcon icon={conf.icon} className="w-4 h-4" aria-hidden />
      {mode === "admin" && conf.label}
    </button>
  );
}
