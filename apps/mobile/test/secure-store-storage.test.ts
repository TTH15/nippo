import { describe, expect, it, vi } from "vitest";

const { setItemAsync, deleteItemAsync } = vi.hoisted(() => ({
  setItemAsync: vi.fn<(key: string, value: string) => Promise<void>>(),
  deleteItemAsync: vi.fn<(key: string) => Promise<void>>(),
}));

vi.mock("expo-secure-store", () => ({ setItemAsync, deleteItemAsync }));

import { flushAuthStorage, secureStoreStorage } from "../src/auth/secureStoreStorage";

describe("secureStoreStorage", () => {
  it("保存中にログアウトしても、削除を最後に実行する", async () => {
    let finishWrite: () => void = () => {};
    setItemAsync.mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    deleteItemAsync.mockResolvedValueOnce();

    secureStoreStorage.setItem("nippo_token", "old-token");
    secureStoreStorage.removeItem("nippo_token");
    await vi.waitFor(() => expect(setItemAsync).toHaveBeenCalledWith("nippo_token", "old-token"));
    expect(deleteItemAsync).not.toHaveBeenCalled();

    finishWrite();
    await flushAuthStorage();
    expect(deleteItemAsync).toHaveBeenCalledWith("nippo_token");
    expect(secureStoreStorage.getItem("nippo_token")).toBeNull();
  });

  it("削除失敗を呼び出し元へ知らせる", async () => {
    deleteItemAsync.mockRejectedValueOnce(new Error("device storage unavailable"));
    secureStoreStorage.removeItem("nippo_driver");
    await expect(flushAuthStorage()).rejects.toThrow("device storage unavailable");
  });
});
