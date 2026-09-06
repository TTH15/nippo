// プレビュー実行時の「いま開いているページ・シナリオ・役割」を保持する。
// 差し替えモジュール（api / swr / next 互換）はここから現在の fixture ストアを取る。
import { createContext, useContext, useSyncExternalStore } from "react";
import type { FixtureStore } from "@/lib/preview/fixtureStore";

export type PreviewRuntime = {
  store: FixtureStore;
  /** 本番のパス（"/admin/vehicles"）。usePathname と AdminLayout のアクティブ判定に使う */
  pathname: string;
  /** window.location.search（"?scenario=..." を含む） */
  search: string;
  /** 本番のパス（"/admin/..."）へ遷移する。プレビューのURLへ変換して pushState する */
  navigate: (href: string) => void;
};

let current: PreviewRuntime | null = null;

/** フック以外（apiFetch・getStoredDriver・Link の href）が読む現在値。描画前に admin.tsx が設定する */
export function setPreviewRuntime(runtime: PreviewRuntime) {
  current = runtime;
}

/** フックはコンテキスト経由で受け取る（描画中に購読者へ通知しないため） */
export const PreviewRuntimeContext = createContext<PreviewRuntime | null>(null);

export function getPreviewRuntime(): PreviewRuntime {
  if (!current) throw new Error("Preview runtime is not initialized");
  return current;
}

export function usePreviewRuntime(): PreviewRuntime {
  const runtime = useContext(PreviewRuntimeContext);
  if (!runtime) throw new Error("PreviewRuntimeContext is missing");
  return runtime;
}

/** ストアの更新（書き込み・リセット）で再描画するためのフック。revision を返す */
export function useStoreRevision(store: FixtureStore): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
