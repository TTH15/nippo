"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { swrFetcher } from "@/lib/swr";

// データ取得を統一するための薄いラッパ（管理画面・ドライバー画面 共通）。
// 以降のページ移行はこの useApi を呼ぶだけにして規約を揃える。
//
// 使い方:
//   const { data, isInitialLoading, refresh } = useApi<{ courses: Course[] }>(
//     "/api/admin/courses",
//   );
//
// - key を null にすると取得をスキップ（条件付き取得）。
// - fetcher は既定で swrFetcher を使うため、Providers(SWRConfig) の有無に依存しない
//   （= テストなど Provider 外でも動作する）。config.fetcher で上書き可能。
// - isInitialLoading: キャッシュが無い初回のみ true。スケルトン表示はこれで判定し、
//   再訪・期間切替時の点滅を避ける。
export function useApi<T = unknown>(
  key: string | null,
  config?: SWRConfiguration<T>,
) {
  const swr = useSWR<T>(key, { fetcher: swrFetcher, ...config });

  return {
    ...swr,
    // 初回ロード（キャッシュ未取得）のみ true。
    isInitialLoading: swr.isLoading && swr.data === undefined,
    // 書き込み後などに最新化したいときに呼ぶ。
    refresh: () => swr.mutate(),
  };
}
