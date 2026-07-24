"use client";

import { useEffect, useState } from "react";
import { apiFetch, getStoredDriver, setAuth, type StoredDriver } from "@/lib/api";

// ============================================================
// アプリ起動時に権限を最新化する（roadmap F / 2026-07-24）。
//
// 背景: 権限（capability）は localStorage の nippo_driver にログイン時の
// スナップショットとして焼き付けられ、hasCapability() はそれを見ている。
// そのため後から権限を付与しても、再ログインするまで画面に反映されず
// 「管理者なのにボタンが押せない」（例: can_dispatch を新設した直後）が起きていた。
//
// /api/auth/session は DB の最新 role/capability でセッションを再発行する
// （サーバー側は元々最新なので、これは画面出し分けのための同期）。
// トップ着地時だけでなく、admin 画面を直接開いたときにも通るよう共通化する。
//
// 割り切り: 開きっぱなしのタブは即時追従しない（次に開いた/再マウントした
// ときに最新化される）。常時追従は Realtime/ポーリングが要り割に合わない。
// ============================================================

let lastSyncedAt = 0;
// 同一起動内で何度もマウントされても叩きすぎない（画面遷移のたびの往復を避ける）
const SYNC_MIN_INTERVAL_MS = 60_000;

/** page.tsx が独自に session を叩いた直後に呼び、直後の重複同期を抑える。 */
export function markSessionSynced(): void {
  lastSyncedAt = Date.now();
}

export type SyncState = "syncing" | "done";

/**
 * 起動時に1回、権限を再同期する。
 * 返り値でスケルトン表示の要否を判断できる（初回のみ syncing）。
 * オフライン等で失敗しても、既存のキャッシュ値で続行する（画面は止めない）。
 */
export function useSyncSession(): SyncState {
  const [state, setState] = useState<SyncState>(() => {
    // 未ログイン、または直近で同期済みなら待たせない
    if (!getStoredDriver()) return "done";
    if (Date.now() - lastSyncedAt < SYNC_MIN_INTERVAL_MS) return "done";
    return "syncing";
  });

  useEffect(() => {
    const cached = getStoredDriver();
    if (!cached) {
      setState("done");
      return;
    }
    if (Date.now() - lastSyncedAt < SYNC_MIN_INTERVAL_MS) {
      setState("done");
      return;
    }

    let cancelled = false;
    apiFetch<{ token: string; driver: StoredDriver }>("/api/auth/session")
      .then(({ token, driver }) => {
        if (cancelled) return;
        setAuth(token, driver);
        lastSyncedAt = Date.now();
      })
      .catch(() => {
        // オフライン・一時的な失敗はキャッシュ値のまま続行（apiFetch が 401 は /login へ飛ばす）
      })
      .finally(() => {
        if (!cancelled) setState("done");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
