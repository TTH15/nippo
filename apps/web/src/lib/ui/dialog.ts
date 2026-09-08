"use client";

// ============================================================
// モーダルのキーボード操作をひとまとめにするフック。
//   - Esc で閉じる
//   - 開いたときに中の最初の操作へフォーカスを移す
//   - Tab が背面へ抜けないよう、中で巡回させる
//   - 閉じたら開く前の要素へフォーカスを戻す
// 地図作戦盤の監査（2026-09-08 P3-1）で、設定・移動登録のモーダルが
// どれも満たしていなかったため共通化した。他の画面でも使う。
// ============================================================

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useModalKeys(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // 開いた直後に中へフォーカスを入れる（入れないと Tab が背面から始まる）
    const first = focusable()[0];
    if (first) first.focus();
    else panel?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === firstItem || !panel?.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, panelRef]);
}
