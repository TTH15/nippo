// "swr/infinite" の差し替え。getKey を size 回たどり、各ページを fixture ストアから同期的に解決する。
import { useCallback, useMemo, useState } from "react";
import { getPreviewRuntime, usePreviewRuntime, useStoreRevision } from "./runtime";

type GetKey<T> = (index: number, previousPageData: T | null) => string | null;

export default function useSWRInfinite<T = unknown>(getKey: GetKey<T>, _fetcher?: unknown, _config?: unknown) {
  const runtime = usePreviewRuntime();
  const revision = useStoreRevision(runtime.store);
  const [size, setSizeState] = useState(1);

  const pages = useMemo(() => {
    const data: T[] = [];
    let error: Error | undefined;
    let pending = false;
    let previous: T | null = null;
    for (let index = 0; index < size; index += 1) {
      const key = getKey(index, previous);
      if (!key) break;
      const resolution = runtime.store.resolve(key);
      if (resolution.status === "pending") { pending = true; break; }
      if (resolution.status === "error") { error = resolution.error; break; }
      previous = resolution.data as T;
      data.push(previous);
    }
    return { data, error, pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.store, revision, size]);

  const setSize = useCallback(async (next: number | ((current: number) => number)) => {
    setSizeState((current) => (typeof next === "function" ? next(current) : next));
    return undefined;
  }, []);

  const mutate = useCallback(async () => {
    getPreviewRuntime().store.invalidate();
    return undefined;
  }, []);

  return {
    data: pages.pending && pages.data.length === 0 ? undefined : pages.data,
    error: pages.error,
    isLoading: pages.pending && pages.data.length === 0,
    isValidating: pages.pending,
    size,
    setSize,
    mutate,
  };
}
