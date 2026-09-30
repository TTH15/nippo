import { previewRequests, previewRequestSlots, savePreviewRequests, requestPeriods } from "../../apps/mobile/ui-preview/shift-request-fixture";
import { previewAccountBank, previewAccountProfile } from "../../apps/mobile/ui-preview/account-fixture";
import { previewVehicle } from "../../apps/mobile/ui-preview/vehicle";
import { previewReportForm, savePreviewReport } from "../../apps/mobile/ui-preview/report-fixture";
import { secureStoreStorage } from "../../apps/mobile/src/auth/secureStoreStorage";
export const scenario = new URLSearchParams(location.search).get("scenario") || "normal";
let keys = scenario === "empty" ? [] : [{ id: "fake-key", name: scenario === "long-name" ? "業務用スマートフォンのかんたんログイン".repeat(4) : "ハコ虎アプリ" }];
let recent = false;
let failed = false;
export function setAuth(token = "preview-only", driver = { name: "サンプルドライバー" }) {
  recent = true;
  secureStoreStorage.setItem("nippo_token", token);
  secureStoreStorage.setItem("nippo_driver", JSON.stringify(driver));
}
export async function apiFetch(path: string, options: { body?: string; method?: string } = {}) {
  const route = new URL(path, "https://preview.invalid");
  if (route.pathname === "/api/reports/profile") return previewAccountProfile();
  if (route.pathname === "/api/me/registration") return previewAccountBank(options.method === "POST" ? JSON.parse(options.body || "{}") : undefined);
  if (route.pathname === "/api/shifts/requests") return options.method === "POST" ? savePreviewRequests(JSON.parse(options.body || "{}").month, JSON.parse(options.body || "{}").offEntries) : { requests: previewRequests(route.searchParams.get("month") || "2026-09"), slots: previewRequestSlots };
  if (route.pathname === "/api/shifts/deadlines") return { periods: requestPeriods(route.searchParams.get("month") || "2026-09") };
  if (route.pathname === "/api/reports/vehicles") return { vehicles: [previewVehicle] };
  if (route.pathname === "/api/reports/vehicles-unlinked") return { vehicles: [] };
  if (route.pathname === "/api/me/report-form") return previewReportForm(route.searchParams.get("date") || "2026-09-23");
  if (route.pathname === "/api/reports/v2") { savePreviewReport(JSON.parse(options.body || "{}")); return { ok: true }; }
  const body = JSON.parse(options.body || "{}");
  if (scenario === "loading") return new Promise(() => {});
  if (scenario === "error" && !failed) { failed = true; throw new Error("接続できませんでした。もう一度お試しください"); }
  if (path === "/api/me/passkeys") {
    if (options.method === "DELETE") { keys = keys.filter(key => key.id !== body.id); return { ok: true }; }
    return { keys, canRecoverWithSms: scenario !== "nofactor" };
  }
  if (path === "/api/auth/reauth") return { recent, canUseSms: scenario !== "nofactor", hasPasskey: keys.length > 0 && scenario !== "nofactor" };
  if (path === "/api/otp/send" || path === "/api/auth/reauth/options") return { options: {}, challengeToken: "fake-challenge" };
  if (path === "/api/auth/recover/verify" || path === "/api/auth/reauth/verify") {
    if (body.method !== "passkey" && body.code !== "123456") throw new Error("認証コードが正しくありません");
    recent = true; return { token: "preview-only", driver: { name: "サンプルドライバー" }, reauthToken: "preview-only" };
  }
  if (path.endsWith("/options")) return { options: {}, challengeToken: "fake-challenge" };
  if (path === "/api/auth/webauthn/register/verify") {
    keys = [...keys, { id: `fake-${keys.length}`, name: "ハコ虎アプリ" }]; return { ok: true };
  }
  if (path === "/api/auth/webauthn/login/verify") return { token: "preview-only", driver: { name: "サンプルドライバー" } };
  throw new Error(`Fixture not found: ${path}`);
}
