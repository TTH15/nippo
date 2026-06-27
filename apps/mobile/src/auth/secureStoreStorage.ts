import * as SecureStore from "expo-secure-store";
import type { KeyValueStorage } from "@repo/core/auth";

// ============================================================
// SecureStore を裏に持つ「同期」キー値ストレージ。
// @repo/core/auth は同期 getItem/setItem/removeItem を要求するため、
// 起動時に SecureStore からメモリ(Map)へ hydrate し、以後は同期でメモリを読み書きしつつ
// SecureStore へ write-through（fire-and-forget）する。
//   設計: rn-migration-core-layer（RN は SecureStore をメモリキャッシュ型で注入）
// ============================================================

const HYDRATE_KEYS = ["nippo_token", "nippo_driver"] as const;

const cache = new Map<string, string>();

export const secureStoreStorage: KeyValueStorage = {
  getItem: (key) => cache.get(key) ?? null,
  setItem: (key, value) => {
    cache.set(key, value);
    void SecureStore.setItemAsync(key, value).catch(() => {});
  },
  removeItem: (key) => {
    cache.delete(key);
    void SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

/** 起動時に SecureStore の保存値をメモリへ読み込む（同期読みを成立させるため）。 */
export async function hydrateAuthStorage(): Promise<void> {
  for (const key of HYDRATE_KEYS) {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value != null) cache.set(key, value);
    } catch {
      // 読めなくても起動は続行（未ログイン扱い）
    }
  }
}
