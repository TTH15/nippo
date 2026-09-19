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

import { useEffect, useRef, type RefObject } from "react";

// `tabindex="-1"` はどの種類でも巡回から外す。タブUIの roving tabindex で
// 選択されていないタブが先頭に来ると、Shift+Tab が一致せず背面へ抜ける
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
]
  .map((selector) => `${selector}:not([tabindex='-1'])`)
  .join(",");

export function useModalKeys(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
): void {
  // ★onClose を deps に入れない。呼び出し側が useCallback([dirty]) などで
  //   関数を作り直すと、そのたびに effect が破棄・再実行され、
  //   「閉じる前の要素へ戻す」→「中の先頭へ移す」が走って**入力中のフォーカスが奪われる**。
  //   最新の onClose は ref 越しに読む。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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

    /**
     * このパネルの上に別のダイアログ（確認・エラー）が載っているか。
     * ここは capture なので、載っているのに止めてしまうと、内側のダイアログが
     * document のバブルで受けている Escape が届かず、外側だけが閉じて確認が取り残される。
     */
    const nestedDialogOpen = () =>
      Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).some(
        (el) => !panel?.contains(el),
      );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (nestedDialogOpen()) return; // 内側のダイアログに渡す
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      if (nestedDialogOpen()) return; // フォーカスの閉じ込めも内側に譲る
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
  }, [open, panelRef]);
}
