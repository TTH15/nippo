"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 固定列やスクロール枠に隠れない短い補足。開閉は対象のマーク自身で制御する。 */
export function Tooltip({ id, anchor, onClose, children }: {
  id: string;
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !contentRef.current) return;
    const margin = 8;
    const gap = 6;
    const updatePosition = () => {
      const trigger = anchor.getBoundingClientRect();
      const content = contentRef.current?.getBoundingClientRect();
      if (!content) return;
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = window.innerHeight;
      if (trigger.bottom < 0 || trigger.top > height || trigger.right < 0 || trigger.left > width) {
        onClose();
        return;
      }
      const below = trigger.bottom + gap;
      const top = below + content.height <= height - margin ? below : trigger.top - gap - content.height;
      setPosition({
        left: Math.max(margin, Math.min(trigger.right - content.width, width - content.width - margin)),
        top: Math.max(margin, Math.min(top, height - content.height - margin)),
      });
    };
    updatePosition();

    // Tab移動に伴う自動スクロールでは補足を消さず、移動先に追従する。
    const handleScroll = () => {
      if (document.activeElement === anchor) updatePosition();
      else onClose();
    };
    // Escapeは補足だけを閉じる。
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [anchor, children, onClose]);

  if (!anchor) return null;
  return createPortal(
    <span
      ref={contentRef}
      id={id}
      role="tooltip"
      data-export-omit
      data-html2canvas-ignore
      className="pointer-events-none fixed z-[9999] w-max max-w-[min(16rem,calc(100vw-1rem))] whitespace-normal break-words rounded bg-slate-900 px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-white shadow-lg"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
    >
      {children}
    </span>,
    document.body,
  );
}
