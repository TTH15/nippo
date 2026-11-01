"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api";
import { reauthHeaders } from "@/lib/components/RecentAuth";

export async function registerPasskey(reauthToken?: string, recoveryId?: string) {
  const headers = { ...reauthHeaders(reauthToken), ...(recoveryId ? { "x-recovery-request": recoveryId } : {}) };
  const { options, challengeToken } = await apiFetch<{
    options: Parameters<typeof startRegistration>[0]["optionsJSON"];
    challengeToken: string;
  }>("/api/auth/webauthn/register/options", { method: "POST", headers });
  const response = await startRegistration({ optionsJSON: options });
  await apiFetch("/api/auth/webauthn/register/verify", {
    method: "POST", headers, body: JSON.stringify({ response, challengeToken }),
  });
}
