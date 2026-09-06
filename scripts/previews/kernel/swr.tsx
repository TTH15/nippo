// "swr" の差し替え。キー文字列を fixture ストアから同期的に解決する（ネットワーク・キャッシュ層なし）。
// 本物の @/lib/useApi・@/lib/swr はそのまま使い、内部で呼ぶ useSWR / mutate だけをこれにする。
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPreviewRuntime, usePreviewRuntime, useStoreRevision } from "./runtime";

export type SWRConfiguration<T = unknown> = {
  fetcher?: (key: string) => Promise<T> | T;
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
  revalidateOnMount?: boolean;
  dedupingInterval?: number;
  keepPreviousData?: boolean;
  fallbackData?: T;
  onSuccess?: (data: T) => void;
  onError?: (error: unknown) => void;
};

type Key = string | null | undefined | false | (() => string | null) | readonly unknown[];

function resolveKey(key: Key): string | null {
  if (typeof key === "function") {
    try {
      return key() ?? null;
    } catch {
      return null;
    }
  }
  if (!key) return null;
  if (Array.isArray(key)) return key.join("|");
  return String(key);
}

type Fetcher<T> = (key: string) => Promise<T> | T;

export default function useSWR<T = unknown>(key: Key, fetcherOrConfig?: Fetcher<T> | SWRConfiguration<T> | null, maybeConfig?: SWRConfiguration<T>) {
  const runtime = usePreviewRuntime();
  const revision = useStoreRevision(runtime.store);
  const resolvedKey = resolveKey(key);
  const config = (typeof fetcherOrConfig === "function" ? maybeConfig : fetcherOrConfig) ?? {};
  // 画面固有の fetcher（ダッシュボードの集計など）だけは非同期に実行する。
  // 既定の fetcher（swrFetcher）は結局ストアを読むだけなので、同期解決に置き換える。
  const customFetcher = config.fetcher;
  const [custom, setCustom] = useState<{ key: string; revision: number; data?: T; error?: unknown } | null>(null);

  useEffect(() => {
    if (!customFetcher || !resolvedKey) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => customFetcher(resolvedKey))
      .then(
        (data) => { if (!cancelled) setCustom({ key: resolvedKey, revision, data }); },
        (error) => { if (!cancelled) setCustom({ key: resolvedKey, revision, error }); },
      );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey, revision, !!customFetcher]);

  const resolution = useMemo(() => {
    if (!resolvedKey) return null;
    if (customFetcher) return null;
    return runtime.store.resolve(resolvedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.store, resolvedKey, revision, !!customFetcher]);

  const mutate = useCallback(async (next?: T | ((current?: T) => T)) => {
    const store = getPreviewRuntime().store;
    // 楽観更新の値は受け取っても保持しない（本番でも再検証で上書きされる）。再描画だけ促す。
    void next;
    store.invalidate();
    return undefined as T | undefined;
  }, []);

  if (!resolvedKey) return { data: undefined as T | undefined, error: undefined, isLoading: false, isValidating: false, mutate };
  if (customFetcher) {
    const ready = custom && custom.key === resolvedKey;
    return {
      data: (ready ? custom.data : config.fallbackData) as T | undefined,
      error: ready ? custom.error : undefined,
      isLoading: !ready,
      isValidating: !ready || custom.revision !== revision,
      mutate,
    };
  }
  if (!resolution || resolution.status === "pending") {
    return { data: config.fallbackData as T | undefined, error: undefined, isLoading: true, isValidating: true, mutate };
  }
  if (resolution.status === "error") return { data: undefined as T | undefined, error: resolution.error, isLoading: false, isValidating: false, mutate };
  return { data: resolution.data as T, error: undefined, isLoading: false, isValidating: false, mutate };
}

/** グローバル mutate（invalidateApi が使う）。条件に関わらずストア全体を再描画させる */
export async function mutate(_matcher?: unknown, _data?: unknown, _options?: unknown) {
  getPreviewRuntime().store.invalidate();
  return [];
}

export function SWRConfig({ children }: { children: React.ReactNode; value?: unknown }) {
  return children;
}
