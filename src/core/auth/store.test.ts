import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  configureAuth,
  getToken,
  getStoredDriver,
  setAuth,
  clearAuth,
  handleUnauthorized,
} from "./index";
import type { KeyValueStorage, StoredDriver } from "./types";

// テスト用のメモリ実装。RN 側のメモリキャッシュ型アダプタの最小例も兼ねる。
function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const driver: StoredDriver = { id: "d1", name: "山田", role: "driver" };

describe("core/auth store", () => {
  beforeEach(() => {
    configureAuth({ storage: memoryStorage(), onUnauthorized: () => {} });
  });

  it("未ログインなら token / driver は null", () => {
    expect(getToken()).toBeNull();
    expect(getStoredDriver()).toBeNull();
  });

  it("setAuth でトークンとドライバーを保存・取得できる", () => {
    setAuth("tok123", driver);
    expect(getToken()).toBe("tok123");
    expect(getStoredDriver()).toEqual(driver);
  });

  it("clearAuth で保存値を破棄する", () => {
    setAuth("tok123", driver);
    clearAuth();
    expect(getToken()).toBeNull();
    expect(getStoredDriver()).toBeNull();
  });

  it("壊れた driver 値なら null を返す（throw しない）", () => {
    const storage = memoryStorage();
    storage.setItem("nippo_driver", "{not json");
    configureAuth({ storage });
    expect(getStoredDriver()).toBeNull();
  });

  it("handleUnauthorized は保存値破棄＋遷移ハンドラ発火", () => {
    const onUnauthorized = vi.fn();
    configureAuth({ storage: memoryStorage(), onUnauthorized });
    setAuth("tok123", driver);

    handleUnauthorized();

    expect(getToken()).toBeNull();
    expect(getStoredDriver()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
