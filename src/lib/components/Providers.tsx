"use client";

import { SWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr";

// 管理画面共通のデータ取得プロバイダ。
// (admin)/layout.tsx に設置し、管理画面のページ間遷移をまたいで
// キャッシュ・設定を共有する（= 再訪時の点滅をなくす）。
//
// グローバル設定は意図的に最小限にする:
// - fetcher: useApi が fetcher 指定なしで使えるようにする共通取得関数
// - dedupingInterval: 同一キーの多重取得を抑制
// keepPreviousData / revalidateOnFocus などの踏み込んだ設定は、
// 既に独自に useSWR を使う既存ページ（users / sales 等）の挙動を変えないよう、
// グローバルには置かず各ページ側で必要に応じて指定する。
// （revalidateOnMount / revalidateOnFocus は SWR 既定で有効なため未指定でも効く）
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        dedupingInterval: 3000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
