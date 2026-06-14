"use client";

import { SWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr";

// 管理画面共通のデータ取得プロバイダ。
// (admin)/layout.tsx に設置し、管理画面のページ間遷移をまたいで
// キャッシュ・設定を共有する（= 再訪時の点滅をなくす）。
//
// 方針: 即表示 + 裏で再検証（stale-while-revalidate）
// - revalidateOnMount: 再訪時もキャッシュを即表示しつつ裏で更新
// - keepPreviousData: 期間切替などキー変更時に旧データを保持し点滅を回避
// - revalidateOnFocus: タブ復帰時に最新化
// - dedupingInterval: 同一キーの多重取得を抑制
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        revalidateOnMount: true,
        revalidateOnFocus: true,
        keepPreviousData: true,
        dedupingInterval: 3000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}
