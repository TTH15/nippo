// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { androidSigningFingerprints, nativeAndroidOrigins } from "./nativeAssociation";
import { GET as android } from "@/app/.well-known/assetlinks.json/route";
import { GET as apple } from "@/app/.well-known/apple-app-site-association/route";

afterEach(() => vi.unstubAllEnvs());
describe("ネイティブのドメイン関連付け", () => {
  it("設定前は関連付けを公開せず、Android originを増やさない", () => {
    vi.stubEnv("PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS", "");
    vi.stubEnv("PASSKEY_APPLE_APP_ID", "");
    expect(nativeAndroidOrigins()).toEqual([]);
    expect(android().status).toBe(503);
    expect(apple().status).toBe(503);
  });
  it("DALとoriginを同じ証明書から作り、重複を除く", async () => {
    const fingerprint = Array(32).fill("ab").join(":");
    vi.stubEnv("PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS", `${fingerprint}, ${fingerprint}`);
    expect(androidSigningFingerprints()).toEqual([fingerprint.toUpperCase()]);
    expect(nativeAndroidOrigins()).toEqual([`android:apk-key-hash:${Buffer.alloc(32, 0xab).toString("base64url")}`]);
    const res = android();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([{ relation: ["delegate_permission/common.get_login_creds"], target: {
      namespace: "android_app", package_name: "jp.hakotora.app", sha256_cert_fingerprints: [fingerprint.toUpperCase()],
    } }]);
  });
  it.each(["*", "https://evil.example", "android:apk-key-hash:fake", "AA:BB", `${Array(32).fill("AB").join(":")},`])("証明書以外を許可しない: %s", value => {
    vi.stubEnv("PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS", value);
    expect(() => nativeAndroidOrigins()).toThrow();
    expect(android().status).toBe(503);
  });
  it("指定したアプリだけにwebcredentialsを関連付ける", async () => {
    vi.stubEnv("PASSKEY_APPLE_APP_ID", "TESTTEAM01.jp.hakotora.app");
    expect(await apple().json()).toEqual({ webcredentials: { apps: ["TESTTEAM01.jp.hakotora.app"] } });
    vi.stubEnv("PASSKEY_APPLE_APP_ID", "TESTTEAM01.jp.hakotora.base");
    expect(apple().status).toBe(503);
  });
});
