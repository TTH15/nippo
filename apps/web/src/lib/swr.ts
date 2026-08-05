"use client";

import { mutate } from "swr";
import { apiFetch } from "@/lib/api";

// SWR 共通 fetcher。
// 既存の apiFetch をそのまま利用するため、401 リダイレクトや
// CSV/非JSON ハンドリングなどの挙動は一切変えない。
// SWR のキーは原則「API パス（クエリ込み）」の文字列とする。
//
// cache: "no-store" でブラウザ HTTP キャッシュをバイパスし、SWR を唯一の
// キャッシュ層にする（再検証時は必ずネットワークから最新を取得）。
export function swrFetcher<T = unknown>(key: string): Promise<T> {
  return apiFetch<T>(key, { cache: "no-store" });
}

/**
 * 書き込み後に、関連する画面のキャッシュをまとめて無効化する。
 *
 * SWR のキャッシュはキー単位なので、各ページが自分のキーしか mutate しないと
 * 「コース画面で担当を設定 → ドライバー一覧では未設定のまま」のような取り残しが起きる
 * （dedupingInterval が長い画面ほど顕著・2026-08-06 指摘）。
 * 影響するリソースのパス接頭辞を渡して、横断的に再取得させる。
 *
 * useSWRInfinite のキーは内部で "$inf$…" が前置されるため、startsWith ではなく includes で判定する。
 */
export function invalidateApi(...prefixes: string[]) {
  return mutate(
    (key) => typeof key === "string" && prefixes.some((p) => key.includes(p)),
    undefined,
    { revalidate: true },
  );
}
