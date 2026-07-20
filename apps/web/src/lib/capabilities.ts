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

/**
 * 運営画面へ入れるアカウントか。capability を1つでも持てば運営（ACCOUNTING・
 * カスタムロールも対象）。capabilities 未取得の旧キャッシュは role でフォールバック。
 * ルート振り分け(app/page.tsx)・モード切替FAB・(admin) 入口ガードで共通利用。
 */
export function canEnterAdmin(
  driver?: { capabilities?: string[]; role?: string } | null,
): boolean {
  if (!driver) return false;
  return (
    (driver.capabilities?.length ?? 0) > 0 ||
    driver.role === "ADMIN" ||
    driver.role === "ADMIN_VIEWER"
  );
}
