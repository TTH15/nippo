"use client";

import { useEffect, useState } from "react";

/**
 * 現在のホストが WebAuthn の rpID と一致するか。
 * Passkeyはドメイン(rpID)に紐づくため、rpIDと異なるドメイン(例: *.vercel.app)で
 * 登録/ログインを試みると必ず失敗する。UIを出す前にこのフックで判定する。
 */
export function useIsWebAuthnHost(): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const rpId = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID;
    setMatch(!!rpId && window.location.hostname === rpId);
  }, []);
  return match;
}
