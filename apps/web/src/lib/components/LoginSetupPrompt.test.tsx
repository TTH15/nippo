import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
const m = vi.hoisted(() => ({ api: vi.fn(), register: vi.fn(), supported: true }));
vi.mock("@/lib/api", () => ({ apiFetch: m.api }));
vi.mock("@/lib/registerPasskey", () => ({ registerPasskey: m.register }));
vi.mock("@/lib/webauthnHost", () => ({ useIsWebAuthnHost: () => m.supported }));
import { LoginSetupPrompt } from "./LoginSetupPrompt";
let state: { phoneVerified: boolean; phoneMasked: string | null; hasPasskey: boolean };
function mount() {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <LoginSetupPrompt /><label>日報の個数<input defaultValue="42" /></label><button type="button">日報を提出</button>
  </SWRConfig>);
}
beforeEach(() => {
  vi.resetAllMocks(); m.supported = true;
  state = { phoneVerified: false, phoneMasked: "下4桁 0001", hasPasskey: false };
  m.api.mockImplementation(async (path: string) => {
    if (path === "/api/me/login-setup") return { ...state };
    if (path === "/api/me/phone/verify") { state.phoneVerified = true; return { reauthToken: "sms-proof" }; }
    if (path === "/api/auth/reauth") return { recent: true, canUseSms: true, hasPasskey: false };
    return { ok: true };
  });
  m.register.mockResolvedValue(undefined);
});
it("未完了なら案内し、自動送信や日報の無効化はしない", async () => {
  mount(); expect(await screen.findByRole("button", { name: "設定する" })).toBeEnabled();
  expect(m.api.mock.calls.every(([path]) => path === "/api/me/login-setup")).toBe(true);
  expect(screen.getByRole("button", { name: "日報を提出" })).toBeEnabled();
});
it("SMS確認からPasskey登録まで同じ画面で進み、入力を保持する", async () => {
  mount(); fireEvent.click(await screen.findByRole("button", { name: "設定する" }));
  expect(screen.getByRole("button", { name: "Passkeyを登録する" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "SMSコードを送る" }));
  fireEvent.change(await screen.findByLabelText("SMS認証コード"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "コードを確認する" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Passkeyを登録する" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Passkeyを登録する" }));
  expect(await screen.findByRole("status")).toHaveTextContent("ログイン設定が完了しました");
  expect(m.api).toHaveBeenCalledWith("/api/auth/reauth", { headers: { "x-reauth-token": "sms-proof" } });
  expect(m.register).toHaveBeenCalledWith("sms-proof");
  expect(screen.getByLabelText("日報の個数")).toHaveValue("42");
});
it("登録済みの人には案内を出さない", async () => {
  state = { ...state, phoneVerified: true, hasPasskey: true };
  mount(); await waitFor(() => expect(m.api).toHaveBeenCalled());
  expect(screen.queryByRole("region", { name: "ログイン設定" })).toBeNull();
});
it("設定の取得失敗は再読込でき、日報の入力を消さない", async () => {
  m.api.mockRejectedValueOnce(new Error("offline")); mount();
  fireEvent.click(await screen.findByRole("button", { name: "もう一度読み込む" }));
  expect(await screen.findByRole("button", { name: "設定する" })).toBeEnabled();
  expect(screen.getByLabelText("日報の個数")).toHaveValue("42");
});
it("SMS確認失敗ではPasskeyへ進まず、入力したコードを残して再試行できる", async () => {
  mount(); fireEvent.click(await screen.findByRole("button", { name: "設定する" }));
  fireEvent.click(screen.getByRole("button", { name: "SMSコードを送る" }));
  fireEvent.change(await screen.findByLabelText("SMS認証コード"), { target: { value: "000000" } });
  m.api.mockRejectedValueOnce(new Error("認証コードが正しくありません"));
  fireEvent.click(screen.getByRole("button", { name: "コードを確認する" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("認証コードが正しくありません");
  expect(screen.getByLabelText("SMS認証コード")).toHaveValue("000000");
  expect(screen.getByRole("button", { name: "Passkeyを登録する" })).toBeDisabled();
  expect(m.register).not.toHaveBeenCalled();
});
it("SMS確認済みでも直近の本人確認を経て鍵を登録する。失敗時は完了にしない", async () => {
  state.phoneVerified = true; m.register.mockRejectedValueOnce(new DOMException("cancel", "NotAllowedError"));
  const original = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (path: string, init?: RequestInit) => path === "/api/auth/reauth"
    ? { recent: false, canUseSms: true, phoneMasked: "下4桁 0001", hasPasskey: false }
    : path === "/api/auth/reauth/verify" ? { reauthToken: "renewed-proof" } : original(path, init));
  mount(); fireEvent.click(await screen.findByRole("button", { name: "設定する" }));
  fireEvent.click(screen.getByRole("button", { name: "Passkeyを登録する" }));
  fireEvent.click(await screen.findByRole("button", { name: "SMSで確認する" }));
  fireEvent.change(await screen.findByLabelText("本人確認のSMS認証コード"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "確認して続ける" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Passkeyの登録が完了しませんでした");
  expect(m.register).toHaveBeenCalledWith("renewed-proof");
  expect(screen.queryByText("ログイン設定が完了しました")).toBeNull();
});
it("電話番号なし・Passkey非対応は対処先を案内し、誤った完了扱いにしない", async () => {
  state.phoneMasked = null; m.supported = false;
  mount(); fireEvent.click(await screen.findByRole("button", { name: "設定する" }));
  expect(screen.getByText(/電話番号が登録されていません/)).toBeInTheDocument();
  expect(screen.getByText(/SafariやChrome/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "SMSコードを送る" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Passkeyを登録する" })).toBeNull();
});
