"use client";
import { useEffect } from "react";

/** 一番手前のダイアログ内でTabを循環。別Portalの選択肢は選択部品へ任せる。 */
export function useDialogTabLoop() {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || (document.activeElement instanceof Element && document.activeElement.closest("[data-custom-select-popup]"))) return;
      const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(el => !el.closest('[inert], [hidden]') && el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
}
