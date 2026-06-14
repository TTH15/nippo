"use client";

import { apiFetch } from "@/lib/api";

// SWR 共通 fetcher。
// 既存の apiFetch をそのまま利用するため、401 リダイレクトや
// CSV/非JSON ハンドリングなどの挙動は一切変えない。
// SWR のキーは原則「API パス（クエリ込み）」の文字列とする。
export function swrFetcher<T = unknown>(key: string): Promise<T> {
  return apiFetch<T>(key);
}
