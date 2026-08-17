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
 * 書き込み後に、関連する画面のキャッシュをまとめて再取得させる。
 *
 * SWR のキャッシュはキー単位なので、各ページが自分のキーしか mutate しないと
 * 「コース画面で担当を設定 → ドライバー一覧では未設定のまま」のような取り残しが起きる
 * （dedupingInterval が長い画面ほど顕著・2026-08-06 指摘）。
 * 影響するリソースのパス接頭辞を渡して、横断的に再取得させる。
 *
 * useSWRInfinite のキーは内部で "$inf$…" が前置されるため、startsWith ではなく includes で判定する。
 *
 * ★キャッシュを undefined で潰さないこと（引数1つの mutate = 再検証のみ）。
 *   以前は `mutate(matcher, undefined, { revalidate: true })` としており、data が
 *   一旦 undefined に戻るため購読側の isInitialLoading が true に跳ね、
 *   **編集中の画面に「読み込み中」が挟まって内容が消えていた**
 *   （請求書エディタは自動保存のたびに再マウントし、Undo履歴まで失われていた。2026-08-17 報告）。
 *   新しい値が届くまでは今の表示を保つ ＝ stale-while-revalidate 本来の振る舞い。
 */
export function invalidateApi(...prefixes: string[]) {
  return mutate((key) => typeof key === "string" && prefixes.some((p) => key.includes(p)));
}
