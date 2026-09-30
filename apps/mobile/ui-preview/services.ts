import { previewRequests, previewRequestSlots, savePreviewRequests, requestPeriods } from "./shift-request-fixture";
import { previewShifts } from "./shift-fixture";
import { previewReportCourse as course, previewReportForm, savePreviewReport } from "./report-fixture";
export { setPreviewReportFailure } from "./report-fixture";
import { nextPreviewShiftDate } from "./end-of-day";
import { previewVehicle } from "./vehicle";
import { secureStoreStorage } from "../src/auth/secureStoreStorage";
// 画面調整専用。APIへのフォールバック・端末ストレージへの読み書きは行わない。
import type { StoredDriver } from "@repo/core/auth";
import type { WorkSession } from "../src/api/work";
import type { MeShift } from "@repo/core/types";
if (!__DEV__) throw new Error("画面確認モードは開発サーバー専用です");
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const sampleDriver: StoredDriver = { id: "preview-driver", name: "サンプル 太郎", role: "DRIVER", capabilities: [] };
let driver: StoredDriver | null = sampleDriver;
let session: WorkSession | null = null;
let closed: WorkSession[] = [];
let keys = [{ id: "preview-key", name: "確認用iPhone" }];
let bank = { bankName: "サンプル銀行", bankNo: "1234567", bankHolder: "サンプル タロウ" };
let notifications = [{ id: "preview-notice", kind: "info", title: "明日の配送について", body: "集合場所をご確認ください。", read_at: null as string | null, created_at: new Date().toISOString() }];
const vehicle = previewVehicle;
let hasNextShift = true;
export const setPreviewNextShift = (value: boolean) => { hasNextShift = value; };
const optional: { id: string; name: string; amount: number }[] = [];
export const configureAuth = () => {};
export const configureApi = () => {};
export const getStoredDriver = () => driver;
export const getToken = () => driver ? "preview-only" : null;
export const clearAuth = () => { driver = null; };
export const setAuth = (token = "preview-only", value: StoredDriver = sampleDriver) => {
  driver = value;
  secureStoreStorage.setItem("nippo_token", token);
  secureStoreStorage.setItem("nippo_driver", JSON.stringify(value));
};
export async function bootstrap() { console.info("[ハコ虎] 画面確認モード：架空データ・本番送信なし"); }
export function setPreviewSession(state: "idle" | "working" | "moving" | "ended") {
  const value: WorkSession = { id: "preview-session", vehicle_id: vehicle.id, status: state === "ended" ? "closed" : "open", purpose: state === "moving" ? "move" : "work", started_at: new Date(Date.now() - 2 * 3600_000).toISOString(), start_odometer: 12345, ended_at: state === "ended" ? new Date().toISOString() : null, end_odometer: state === "ended" ? 12410 : null };
  session = state === "working" || state === "moving" ? value : null;
  closed = state === "ended" ? [value] : [];
}
export async function apiUpload(): Promise<never> { throw new Error("画面確認では写真を送信しません"); }
export async function apiFetch<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  const url = new URL(path, "https://preview.invalid");
  const route = url.pathname;
  const method = options.method || "GET";
  let value: unknown;
  if (route === "/api/me/registration") {
    if (method !== "GET") bank = { ...bank, ...body };
    value = { complete: true, kycVerified: true, ...bank };
  } else if (route === "/api/reports/profile") value = { ...sampleDriver, displayName: "サンプル", phone: "09000000000", phoneVerified: true, phoneVerifiedAt: new Date().toISOString(), driverCode: "SAMPLE", officeCode: "DEMO", identities: [{ id: "preview-identity", name: "業務委託", label: "業務委託" }], ...bank };
  else if (route === "/api/reports/vehicles") value = { vehicles: [vehicle] };
  else if (route === "/api/reports/vehicles-unlinked") value = { vehicles: [] };
  else if (route === "/api/work/today") value = { open: session, today: session ? [session, ...closed] : closed };
  else if (route === "/api/work/check-in" || route === "/api/work/check-out") {
    setPreviewSession(route.endsWith("check-in") ? "working" : "ended"); value = { ok: true, code: "ok", session: session ?? closed[0] };
  } else if (route === "/api/vehicle-qr/resolve") value = { ok: true, code: "ok", usage: "owner", vehicle: { id: vehicle.id, numberPrefix: vehicle.number_prefix, numberClass: vehicle.number_class, numberHiragana: vehicle.number_hiragana, numberNumeric: vehicle.number_numeric } };
  else if (route === "/api/me/shifts") {
    const start = url.searchParams.get("start") ?? today(), end = url.searchParams.get("end") ?? today();
    const fixture = previewShifts(start.slice(0, 7));
    value = { ...fixture, shifts: fixture.shifts.filter(s => s.shift_date >= start && s.shift_date <= end && (hasNextShift || s.shift_date <= today())), rest_days: fixture.rest_days?.filter(r => r.date >= start && r.date <= end) };
  }
  else if (route === "/api/me/report-form") value = previewReportForm(url.searchParams.get("date") ?? today());
  else if (route === "/api/reports/v2") {
    savePreviewReport(body);
    value = { ok: true, parkingSaved: !!body.parking, parkingPlaceName: body.parking ? "確認用車庫" : null };
  }
  else if (route === "/api/me/notifications") {
    if (method === "PATCH") notifications = notifications.map(n => body.all || body.ids?.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n);
    value = { notifications, unreadCount: notifications.filter(n => !n.read_at).length };
  } else if (route === "/api/me/invoices") value = { invoices: [] };
  else if (route === "/api/me/rewards") value = { month: url.searchParams.get("month"), startDate: today(), endDate: today(), incomeLog: 240000, variableDeductions: 0, fixedDeductions: 30000, optionalDeductions: optional.reduce((sum, e) => sum + e.amount, 0), net: 210000 - optional.reduce((sum, e) => sum + e.amount, 0), logDetails: [], fixedDetails: [{ id: "preview-lease", name: "車両費", amount: 30000 }], optionalDetails: [...optional] };
  else if (route === "/api/me/optional-expenses" && method === "POST") { optional.push({ id: `preview-${optional.length}`, name: body.name, amount: Number(body.amount) }); value = { ok: true }; }
  else if (route.startsWith("/api/me/optional-expenses/") && method === "DELETE") { const index = optional.findIndex(e => e.id === route.split("/").pop()); if (index >= 0) optional.splice(index, 1); value = { ok: true }; }
  else if (route === "/api/shifts/requests") value = method === "POST" ? savePreviewRequests(body.month, body.offEntries) : { requests: previewRequests(url.searchParams.get("month") || today().slice(0, 7)), slots: previewRequestSlots };
  else if (route === "/api/shifts/deadlines") value = { periods: requestPeriods(url.searchParams.get("month") || today().slice(0, 7)) };
  else if (route === "/api/reports/source-images") value = { images: [], unavailable: true };
  else if (route === "/api/me/passkeys") { if (method === "DELETE") keys = keys.filter(k => k.id !== body.id); value = { keys, canRecoverWithSms: true }; }
  else if (route === "/api/auth/reauth") value = { recent: true, canUseSms: true, hasPasskey: keys.length > 0 };
  else if (route === "/api/otp/send" || route === "/api/me/phone/send" || route.endsWith("/options")) value = { options: {}, challengeToken: "preview-only" };
  else if (route === "/api/auth/webauthn/register/verify") { keys.push({ id: `preview-${keys.length}`, name: "追加した端末" }); value = { ok: true }; }
  else if (route === "/api/auth/webauthn/login/verify") value = { token: "preview-only", driver: sampleDriver };
  else if (["/api/auth/recover/verify", "/api/me/phone/verify", "/api/auth/reauth/verify"].includes(route)) {
    if (body.method !== "passkey" && body.code !== "123456") throw new Error("認証コードが正しくありません");
    value = { ok: true, token: "preview-only", driver: sampleDriver, reauthToken: "preview-only" };
  } else throw new Error(`画面確認用データは未対応です: ${method} ${route}`);
  return value as T;
}
