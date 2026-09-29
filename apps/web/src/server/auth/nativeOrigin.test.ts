// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { nativeAndroidOrigins } from "./nativeAssociation";

afterEach(() => vi.unstubAllEnvs());
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest();
function assertion(origin: string, uv = true, rp = "hakotora.jp") {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
  ]));
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: "test-challenge", origin }));
  const authData = Buffer.concat([sha(rp), Buffer.from([uv ? 5 : 1, 0, 0, 0, 1])]);
  return {
    response: { id: "dGVzdA", rawId: "dGVzdA", type: "public-key" as const, clientExtensionResults: {},
      response: { clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"),
        signature: sign("sha256", Buffer.concat([authData, sha(clientData)]), privateKey).toString("base64url") } },
    credential: { id: "dGVzdA", publicKey: cose, counter: 0 },
    expectedChallenge: "test-challenge", expectedRPID: "hakotora.jp", requireUserVerification: true,
    expectedOrigin: ["https://hakotora.jp", ...nativeAndroidOrigins()],
  };
}
it("実署名でWeb/iOSと登録済みAndroid originを検証する", async () => {
  vi.stubEnv("PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS", Array(32).fill("AB").join(":"));
  for (const origin of ["https://hakotora.jp", ...nativeAndroidOrigins()]) {
    expect((await verifyAuthenticationResponse(assertion(origin))).verified).toBe(true);
  }
});
it("署名が正しくても未登録Android証明書・別サイトを拒否する", async () => {
  vi.stubEnv("PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS", Array(32).fill("AB").join(":"));
  for (const origin of ["https://evil.example", `android:apk-key-hash:${Buffer.alloc(32, 1).toString("base64url")}`]) {
    await expect(verifyAuthenticationResponse(assertion(origin))).rejects.toThrow(/origin/);
  }
});
it("Android origin許可後もUVとRP IDを必須にする", async () => {
  vi.stubEnv("PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS", Array(32).fill("AB").join(":"));
  const origin = nativeAndroidOrigins()[0];
  await expect(verifyAuthenticationResponse(assertion(origin, false))).rejects.toThrow();
  await expect(verifyAuthenticationResponse(assertion(origin, true, "evil.example"))).rejects.toThrow();
});
