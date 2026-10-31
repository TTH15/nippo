"use client";

import { useLayoutEffect, type RefObject } from "react";

/** 固定された担当枠列を除いた日付欄の中央へ、選択列の中心を合わせる。 */
export function selectedColumnScrollLeft(index: number, dayWidth: number, laneWidth: number, viewportWidth: number, scrollWidth: number) {
  const visibleDaysWidth = Math.max(0, viewportWidth - laneWidth);
  const wanted = (index + 0.5) * dayWidth - visibleDaysWidth / 2;
  return Math.max(0, Math.min(Math.max(0, scrollWidth - viewportWidth), wanted));
}

export function useSelectedColumnAnchor(
  scrollerRef: RefObject<HTMLElement | null>, index: number,
  dayWidth: number, laneWidth: number, ready: boolean, panelWidth?: number,
) {
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!ready || index < 0 || !scroller) return;
    const center = () => {
      if (scroller.clientWidth <= 0) return;
      scroller.scrollLeft = selectedColumnScrollLeft(index, dayWidth, laneWidth, scroller.clientWidth, scroller.scrollWidth);
    };
    center();
    let previousWidth = scroller.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const width = scroller.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      center();
    });
    observer?.observe(scroller);
    window.addEventListener("resize", center);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", center);
    };
  }, [scrollerRef, index, dayWidth, laneWidth, ready, panelWidth]);
}
