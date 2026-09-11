import { SignJWT, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { supabase } from "@/server/db/client";
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
// 短命JWT。既存の signToken と同じ jose/JWT_SECRET を再利用する。
// 検証成功後、consumeChallengeToken でDBへ使用済みを原子的に記録する。
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
): Promise<{ challenge: string; identityId: string | null; expiresAt: number }> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
  if (payload.kind !== "webauthn_challenge" || payload.purpose !== expectedPurpose) {
    throw new Error("Invalid challenge token");
  }
  const challenge = payload.challenge;
  if (typeof challenge !== "string" || !challenge) {
    throw new Error("Invalid challenge token");
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("Invalid challenge token");
  }
  const identityId = payload.identity_id ?? null;
  if ((identityId !== null && typeof identityId !== "string") ||
      (expectedPurpose === "register" && !identityId) ||
      (expectedPurpose === "login" && identityId !== null)) {
    throw new Error("Invalid challenge token");
  }
  return {
    challenge,
    identityId,
    expiresAt: payload.exp,
  };
}

/** WebAuthn応答の検証後、セッション発行・鍵保存の前に必ず呼ぶ。 */
export async function consumeChallengeToken(
  token: string,
  purpose: ChallengePurpose,
  identityId: string | null = null,
): Promise<boolean> {
  let verified: Awaited<ReturnType<typeof verifyChallengeToken>>;
  try {
    verified = await verifyChallengeToken(token, purpose);
  } catch {
    return false;
  }
  if (verified.identityId !== identityId) return false;
  const challengeHash = createHash("sha256")
    .update(`${purpose}\0${verified.challenge}`)
    .digest("hex");
  const { data, error } = await supabase.rpc("consume_webauthn_challenge", {
    p_challenge_hash: challengeHash,
    p_expires_at: new Date(verified.expiresAt * 1000).toISOString(),
  });
  if (error) throw new Error("Failed to consume WebAuthn challenge");
  return data === true;
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
