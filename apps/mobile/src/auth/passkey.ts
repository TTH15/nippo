import { Passkey, type PasskeyCreateRequest, type PasskeyGetRequest } from "react-native-passkey";
import { apiFetch } from "@repo/core/api";
import type { StoredDriver } from "@repo/core/auth";

export const PASSKEY_LABEL = "かんたんログイン（パスキー）";
export function supportsPasskey(): boolean {
  try { return process.env.EXPO_PUBLIC_PASSKEY_ENABLED === "true" && Passkey.isSupported(); }
  catch { return false; }
}

const post = <T>(path: string, body: unknown, reauthToken?: string) => apiFetch<T>(path, {
  method: "POST", body: JSON.stringify(body),
  ...(reauthToken ? { headers: { "x-reauth-token": reauthToken } } : {}),
}, { skipAuthRedirect: true });

export async function loginWithPasskey() {
  const { options, challengeToken } = await post<{ options: PasskeyGetRequest; challengeToken: string }>("/api/auth/webauthn/login/options", {});
  const response = await Passkey.get(options);
  return post<{ token: string; driver: StoredDriver }>("/api/auth/webauthn/login/verify", { response, challengeToken });
}

export async function registerPasskey(reauthToken?: string) {
  const { options, challengeToken } = await post<{ options: PasskeyCreateRequest; challengeToken: string }>("/api/auth/webauthn/register/options", {}, reauthToken);
  // OS側に方式を任せる。生体認証のみの可否でパスキーを制限しない。
  const response = await Passkey.create(options);
  return post("/api/auth/webauthn/register/verify", { response, challengeToken, name: "ハコ虎アプリ" }, reauthToken);
}

export async function reauthenticateWithPasskey() {
  const { options, challengeToken } = await post<{ options: PasskeyGetRequest; challengeToken: string }>("/api/auth/reauth/options", { method: "passkey" });
  const response = await Passkey.get(options);
  return post<{ reauthToken: string }>("/api/auth/reauth/verify", { method: "passkey", response, challengeToken });
}

export function passkeyError(error: unknown): string {
  const code = error && typeof error === "object" && "error" in error ? String(error.error) : "";
  if (code === "UserCancelled") return "操作をキャンセルしました";
  if (code === "NoCredentials") return "パスキーが見つかりません。SMSでログインしてください";
  if (["NotSupported", "NoCreateOption"].includes(code)) return "端末の画面ロックとパスキーの保存先を確認してください";
  if (code === "BadConfiguration") return "このアプリでは設定できません。SMSでログインしてください";
  if (code === "CredentialAlreadyExists") return "登録済みのパスキーがあります。一覧を読み直してください";
  return error instanceof Error ? error.message : "完了できませんでした。もう一度お試しください";
}
