import { SignJWT, jwtVerify } from "jose";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

export {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(s);
};

export function rpConfig() {
  return {
    rpID: process.env.WEBAUTHN_RP_ID || "localhost",
    rpName: process.env.WEBAUTHN_RP_NAME || "ハコ虎",
    origin: process.env.WEBAUTHN_ORIGIN || "http://localhost:3000",
  };
}

// -------------------------------------------------------
// Challenge token: WebAuthn の challenge を options→verify の間だけ運ぶための
// 短命JWT。cookieやDBテーブルを増やさず、既存の signToken と同じ jose/JWT_SECRET を
// 再利用する（typ 相当に kind クレームを持たせ通常セッションJWTと区別）。
// -------------------------------------------------------

type ChallengePurpose = "register" | "login";

export async function createChallengeToken(payload: {
  challenge: string;
  purpose: ChallengePurpose;
  identityId?: string | null;
}): Promise<string> {
  return new SignJWT({
    kind: "webauthn_challenge",
    challenge: payload.challenge,
    purpose: payload.purpose,
    identity_id: payload.identityId ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
}

export async function verifyChallengeToken(
  token: string,
  expectedPurpose: ChallengePurpose,
): Promise<{ challenge: string; identityId: string | null }> {
  const { payload } = await jwtVerify(token, secret());
  if (payload.kind !== "webauthn_challenge" || payload.purpose !== expectedPurpose) {
    throw new Error("Invalid challenge token");
  }
  const challenge = payload.challenge;
  if (typeof challenge !== "string" || !challenge) {
    throw new Error("Invalid challenge token");
  }
  return {
    challenge,
    identityId: (payload.identity_id as string | null | undefined) ?? null,
  };
}

// -------------------------------------------------------
// bytea <-> Uint8Array 変換。
// supabase-js(PostgREST) は bytea を "\x<hex>" 形式の文字列として読み書きする。
// -------------------------------------------------------

export function publicKeyToBytea(publicKey: Uint8Array): string {
  return "\\x" + Buffer.from(publicKey).toString("hex");
}

export function byteaToPublicKey(bytea: string): Uint8Array<ArrayBuffer> {
  const hex = bytea.startsWith("\\x") ? bytea.slice(2) : bytea;
  const bytes = Buffer.from(hex, "hex");
  // Buffer は Uint8Array<ArrayBufferLike> だが @simplewebauthn は Uint8Array<ArrayBuffer> を
  // 期待するため、新しい ArrayBuffer 上にコピーして渡す。
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}
