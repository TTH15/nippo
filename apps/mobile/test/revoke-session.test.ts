import { describe, expect, it, vi } from "vitest";
import { revokeSession } from "../src/auth/revokeSession";

describe("ログアウト時のセッション失効", () => {
  it("同じログインのBearerでサーバーの失効を待つ", async () => {
    const send = vi.fn().mockResolvedValue(new Response("{}"));
    await revokeSession("https://example.test", "work-token", send);
    expect(send).toHaveBeenCalledWith("https://example.test/api/auth/logout", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer work-token" }) }));
  });
  it("期限切れは終了できるが、障害時は呼び出し元に失敗を返す", async () => {
    await expect(revokeSession("", "old", vi.fn().mockResolvedValue(new Response("", { status: 401 })))).resolves.toBeUndefined();
    await expect(revokeSession("", "live", vi.fn().mockResolvedValue(new Response("", { status: 503 })))).rejects.toThrow("ログアウトを完了できませんでした");
    await expect(revokeSession("", "live", vi.fn().mockRejectedValue(new Error("offline")))).rejects.toThrow("offline");
  });
});
