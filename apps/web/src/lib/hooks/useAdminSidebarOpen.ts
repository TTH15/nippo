"use client";

import { useSyncExternalStore } from "react";

// ページ本体と一緒に管理レイアウトが再マウントされても開閉状態を維持する。
// ブラウザの再読み込みでは初期化し、認証データや永続ストレージには保存しない。
let open = true;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setAdminSidebarOpen(value: boolean) {
  if (value === open) return;
  open = value;
  listeners.forEach(listener => listener());
}

export function useAdminSidebarOpen() {
  return useSyncExternalStore(subscribe, () => open, () => true);
}
