"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api";
import { reauthHeaders } from "@/lib/components/RecentAuth";

export async function registerPasskey(reauthToken?: string) {
  const { options, challengeToken } = await apiFetch<{
    options: Parameters<typeof startRegistration>[0]["optionsJSON"];
    challengeToken: string;
  }>("/api/auth/webauthn/register/options", { method: "POST", headers: reauthHeaders(reauthToken) });
  const response = await startRegistration({ optionsJSON: options });
  await apiFetch("/api/auth/webauthn/register/verify", {
    method: "POST", headers: reauthHeaders(reauthToken), body: JSON.stringify({ response, challengeToken }),
  });
}
