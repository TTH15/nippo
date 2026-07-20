"use client";

// ============================================================
// 最後に見ていた画面モード（運営 / ドライバー）の記憶と復元。
// スマホは1台で両方を使い分けるため、ログインのたびに運営画面へ飛ばされると
// ドライバー業務の人が毎回切り替える羽目になる。前回のモードを覚えて戻す。
//
// PC では復元しない: ドライバー画面は DriverDesktopNotice で
// 「PC 非対応」表示になるため、復元すると空振りの画面に着地してしまう。
// PC は従来どおり運営画面優先（PC=運営前提という既存方針とも一致）。
// ============================================================

const STORAGE_KEY = "last_app_mode";

export type AppMode = "admin" | "driver";

/** 現在地のモードを記録する。各レイアウトの mount 時に呼ぶ（取りこぼしを防ぐため）。 */
export function rememberAppMode(mode: AppMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // プライベートブラウジング等で書けなくても、既定の遷移で動くので無視する
  }
}

export function getLastAppMode(): AppMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "admin" || v === "driver" ? v : null;
  } catch {
    return null;
  }
}

/** ドライバー画面を出してよい幅か（AdminLayout の md ブレークポイントと揃える）。 */
export function isMobileWidth(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

/**
 * ログイン直後・トップページ着地時の遷移先を決める（判定の純粋部分・テスト対象）。
 * 運営権限が無ければ常にドライバー画面。あればスマホ幅のときだけ前回モードを尊重する。
 */
export function resolveHomePath(params: {
  hasAdminAccess: boolean;
  lastMode: AppMode | null;
  isMobile: boolean;
}): string {
  if (!params.hasAdminAccess) return "/submit";
  if (params.isMobile && params.lastMode === "driver") return "/submit";
  return "/admin";
}
