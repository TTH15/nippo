import * as SecureStore from "expo-secure-store";
import type { KeyValueStorage } from "@repo/core/auth";

// ============================================================
// SecureStore を裏に持つ「同期」キー値ストレージ。
// @repo/core/auth は同期 getItem/setItem/removeItem を要求するため、
// 起動時に SecureStore からメモリ(Map)へ hydrate し、以後は同期でメモリを読み書きしつつ
// SecureStore への書き込みはキーごとに直列化する。
//   設計: rn-migration-core-layer（RN は SecureStore をメモリキャッシュ型で注入）
// ============================================================

const HYDRATE_KEYS = ["nippo_token", "nippo_driver"] as const;

const cache = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

function persist(key: string, operation: () => Promise<void>): void {
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  pending.set(key, next);
  // 同期ストレージの呼び出し元には非同期エラーを返せないため、flush 時に受け取る。
  void next.catch(() => {});
}

/** ログアウトなど、永続化の完了が必要な操作で呼ぶ。失敗時は再試行できる。 */
export async function flushAuthStorage(): Promise<void> {
  await Promise.all([...pending.values()]);
}

export const secureStoreStorage: KeyValueStorage = {
  getItem: (key) => cache.get(key) ?? null,
  setItem: (key, value) => {
    cache.set(key, value);
    persist(key, () => SecureStore.setItemAsync(key, value));
  },
  removeItem: (key) => {
    cache.delete(key);
    persist(key, () => SecureStore.deleteItemAsync(key));
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
