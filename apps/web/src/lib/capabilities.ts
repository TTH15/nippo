"use client";

import { getStoredDriver } from "@/lib/api";

// ============================================================
// クライアント側の権限判定（§2-6）。UI の出し分け専用。
// 正本はサーバー（requirePermission）。ここはボタン表示などの補助で最終判定ではない。
// capabilities はログイン時に StoredDriver へ格納される（login route が配布）。
// ============================================================

/** ログイン中 membership が capability を持つか。 */
export function hasCapability(capability: string): boolean {
  return getStoredDriver()?.capabilities?.includes(capability) ?? false;
}

/** いずれかの capability を持つか。 */
export function hasAnyCapability(...capabilities: string[]): boolean {
  const owned = getStoredDriver()?.capabilities ?? [];
  return capabilities.some((c) => owned.includes(c));
}
