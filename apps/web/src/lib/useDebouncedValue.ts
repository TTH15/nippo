"use client";

import { useEffect, useState } from "react";

/**
 * 値の変化が落ち着いてから反映するフック（連続入力・ドラッグ中にAPIを叩かないため）。
 * sales の検索・map の履歴スライダー等で共用。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
