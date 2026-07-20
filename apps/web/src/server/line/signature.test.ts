import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { verifyLineSignature } from "./signature";

// webhook は JWT を通らない唯一のルートで、この署名検証が認証そのもの。
// 誤って true を返す条件が1つでもあれば、誰でも連携イベントを偽装できる。

const SECRET = "test-channel-secret";

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

beforeEach(() => {
  process.env.LINE_CHANNEL_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.LINE_CHANNEL_SECRET;
});

describe("verifyLineSignature", () => {
  const body = JSON.stringify({ events: [{ type: "follow" }] });

  it("正しい署名を受け入れる", () => {
    expect(verifyLineSignature(body, sign(body))).toBe(true);
  });

  it("別の secret で署名されたものを拒否する", () => {
    expect(verifyLineSignature(body, sign(body, "wrong-secret"))).toBe(false);
  });

  it("ボディが改竄されていれば拒否する", () => {
    const tampered = JSON.stringify({ events: [{ type: "unfollow" }] });
    expect(verifyLineSignature(tampered, sign(body))).toBe(false);
  });

  it("署名ヘッダーが無ければ拒否する", () => {
    expect(verifyLineSignature(body, null)).toBe(false);
  });

  it("空の署名を拒否する", () => {
    expect(verifyLineSignature(body, "")).toBe(false);
  });

  it("長さの違う署名でも例外を投げずに拒否する（timingSafeEqual 対策）", () => {
    expect(() => verifyLineSignature(body, "short")).not.toThrow();
    expect(verifyLineSignature(body, "short")).toBe(false);
  });

  it("secret 未設定なら常に拒否する（default-deny）", () => {
    delete process.env.LINE_CHANNEL_SECRET;
    expect(verifyLineSignature(body, sign(body))).toBe(false);
  });
});
