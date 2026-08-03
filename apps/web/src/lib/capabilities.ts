"use client";

import { getStoredDriver } from "@/lib/api";

// ============================================================
// クライアント側の権限判定（§2-6）。UI の出し分け専用。
// 正本はサーバー（requirePermission）。ここはボタン表示などの補助で最終判定ではない。
// capabilities はログイン時に StoredDriver へ格納される（login route が配布）。
// ============================================================

// サーバー（capabilities.ts の CAPABILITY_IMPLIES）と同じ含意をクライアントでも展開する。
// ログイン済みセッションの capabilities は発行時点の束なので、領域別 capability の追加前に
// ログインした人でも「設定の編集」を持っていれば領域別の編集 UI が出る（再ログイン不要）。
const IMPLIES: Record<string, string[]> = {
  can_manage_org_settings: [
    "can_view_org_settings",
    "can_manage_courses",
    "can_manage_carriers",
    "can_manage_report_kinds",
    "can_manage_submit_screen",
  ],
  can_manage_courses: ["can_view_org_settings"],
  can_manage_carriers: ["can_view_org_settings"],
  can_manage_report_kinds: ["can_view_org_settings"],
  can_manage_submit_screen: ["can_view_org_settings"],
};

function effectiveCapabilities(): Set<string> {
  const out = new Set<string>();
  const stack = [...(getStoredDriver()?.capabilities ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    for (const implied of IMPLIES[c] ?? []) stack.push(implied);
  }
  return out;
}

/** ログイン中 membership が capability を持つか。 */
export function hasCapability(capability: string): boolean {
  return effectiveCapabilities().has(capability);
}

/** いずれかの capability を持つか。 */
export function hasAnyCapability(...capabilities: string[]): boolean {
  const owned = effectiveCapabilities();
  return capabilities.some((c) => owned.has(c));
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
