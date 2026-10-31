"use client";

import { createContext, useEffect, useLayoutEffect, useState } from "react";

export const ShiftWorkspaceContext = createContext<"shift" | "memo">("shift");
type Period = "first" | "second";
type YearMonth = { year: number; month: number };

function storageKey() {
  if (!window.location.pathname.startsWith("/preview/")) return "hakotora_admin_shift_period_v1";
  const params = new URLSearchParams(window.location.search);
  return `hakotora_preview_shift_period_v1:${params.get("scenario") ?? "normal"}:${params.get("role") ?? "admin"}`;
}

/** シフト表とメモの表示期間だけを共有する。プレビューの保存先は本番から隔離。 */
export function useShiftPeriod(initial: YearMonth, initialPeriod: Period) {
  const [yearMonth, setYearMonth] = useState(initial);
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey()) ?? "null");
      if (value && Number.isInteger(value.year) && value.year >= 1900 && value.year <= 2200
        && Number.isInteger(value.month) && value.month >= 1 && value.month <= 12
        && (value.period === "first" || value.period === "second")) {
        setYearMonth({ year: value.year, month: value.month });
        setPeriod(value.period);
      }
    } catch { /* 保存先が使えなくても現在の期間で開く */ }
    setReady(true);
  }, []);
  useLayoutEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(storageKey(), JSON.stringify({ ...yearMonth, period })); }
    catch { /* 表示期間の保存失敗で編集を妨げない */ }
  }, [ready, yearMonth, period]);
  return { yearMonth, setYearMonth, period, setPeriod };
}


/** メニュー分離後も、保存前の共有メモを置いて移動する場合の確認を維持する。 */
export function useMemoNavigationGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const guard = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || (!link.dataset.previewHref && link.getAttribute("href")?.startsWith("#"))) return;
      const url = new URL(link.dataset.previewHref ?? link.href, window.location.href);
      const currentPath = link.dataset.previewHref ? window.location.pathname.replace(/^\/preview\//, "/") : window.location.pathname;
      if (url.pathname === currentPath && (url.search === window.location.search || link.dataset.previewHref && !url.search)) return;
      if (!window.confirm("共有メモに保存前の変更があります。破棄して切り替えますか？")) {
        event.preventDefault();event.stopImmediatePropagation();
      }
    };
    window.addEventListener("click", guard, true);
    return () => window.removeEventListener("click", guard, true);
  }, [enabled]);
}
