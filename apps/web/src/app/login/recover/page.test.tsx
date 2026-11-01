import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({
  api: vi.fn(), push: vi.fn(), setLoginSession: vi.fn(), storedDriver: null as { role: string; capabilities: string[] } | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/lib/api", () => ({
  apiFetch: mock.api,
  setLoginSession: mock.setLoginSession,
  getStoredDriver: () => mock.storedDriver,
}));
vi.mock("@/lib/webauthnHost", () => ({ useIsWebAuthnHost: () => true }));
vi.mock("@/lib/appMode", () => ({ getLastAppMode: () => null, isMobileWidth: () => true, resolveHomePath: () => "/submit" }));
vi.mock("@/lib/components/AccountRecovery", () => ({
  AccountRecovery: ({ onContinue }: { onContinue: () => void }) => <div data-testid="passkey-setup" data-required="true">
    <button onClick={onContinue}>運営ログインへ</button>
  </div>,
}));
import RecoverPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mock.api.mockReset();
  mock.storedDriver = null;
  mock.setLoginSession.mockImplementation((_token, driver) => { mock.storedDriver = driver; });
  mock.api.mockImplementation(async (path: string) => {
    if (path === "/api/otp/send") return { ok: true };
    if (path === "/api/auth/recover/verify") return { token: "test-token", driver: {
      id: "driver-1", name: "架空の担当者", role: "ADMIN", capabilities: ["can_view_members"],
    } };
    if (path === "/api/me/registration") return { complete: false, kycVerified: false, hasPasskey: false };
    throw new Error(`unexpected path: ${path}`);
  });
});
afterEach(cleanup);

async function finishSmsLogin() {
  fireEvent.change(screen.getByLabelText("電話番号"), { target: { value: "09012345678" } });
  fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
  await screen.findByLabelText("SMS認証コード");
  fireEvent.change(screen.getByLabelText("SMS認証コード"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "ログインする" }));
}

describe("電話番号でのログイン後", () => {
  it("登録項目が不足した既存運営アカウントは参加コードではなくPasskey設定へ進む", async () => {
    window.history.replaceState(null, "", "/login/recover?next=admin");
    render(<RecoverPage />);
    await finishSmsLogin();
    expect(await screen.findByTestId("passkey-setup")).toHaveAttribute("data-required", "true");
    expect(mock.push).not.toHaveBeenCalledWith("/join");
  });

  it("申請途中のドライバーは従来どおり初期登録へ戻る", async () => {
    window.history.replaceState(null, "", "/login/recover?next=driver");
    mock.api.mockImplementation(async (path: string) => {
      if (path === "/api/otp/send") return { ok: true };
      if (path === "/api/auth/recover/verify") return { token: "test-token", driver: {
        id: "driver-2", name: "架空のドライバー", role: "DRIVER", capabilities: [],
      } };
      if (path === "/api/me/registration") return { complete: false, kycVerified: false, hasPasskey: false };
      throw new Error(`unexpected path: ${path}`);
    });
    render(<RecoverPage />);
    await finishSmsLogin();
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/join"));
  });

  it("既存パスキーが使えない運営アカウントもSMS後に追加登録へ進める", async () => {
    window.history.replaceState(null, "", "/login/recover?next=admin");
    mock.api.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ token: "sms-token", driver: {
      id: "admin", name: "架空の運営", role: "ADMIN", capabilities: ["can_view_members"],
    } }).mockResolvedValueOnce({ complete: true, kycVerified: true, hasPasskey: true });
    render(<RecoverPage />);
    await finishSmsLogin();
    expect(await screen.findByTestId("passkey-setup")).toHaveAttribute("data-required", "true");
    expect(mock.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "SMSでドライバー画面へ" })).toHaveAttribute("href", "/submit");
    expect(screen.getByRole("link", { name: "登録済みのパスキーでログイン" })).toHaveAttribute("href", "/login?next=admin");
    expect(mock.setLoginSession).toHaveBeenCalledWith("sms-token", expect.any(Object));
    fireEvent.click(screen.getByRole("button", { name: "運営ログインへ" }));
    expect(mock.push).toHaveBeenCalledWith("/login?next=admin");
    expect(mock.push).not.toHaveBeenCalledWith("/admin");
  });

  it.each([false, true])("SMSで本人確認した登録済みドライバーはパスキー有無（%s）によらず業務へ進む", async (hasPasskey) => {
    window.history.replaceState(null, "", "/login/recover?next=driver");
    mock.api.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ token: "sms-token", driver: {
      id: "driver", name: "架空のドライバー", role: "DRIVER", capabilities: [],
    } }).mockResolvedValueOnce({ complete: true, kycVerified: true, hasPasskey });
    render(<RecoverPage />);
    await finishSmsLogin();
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/submit"));
    expect(screen.queryByTestId("passkey-setup")).toBeNull();
  });

  it("SMS後の登録状態確認が失敗したらOTPを再使用せず状態だけ再確認する", async () => {
    window.history.replaceState(null, "", "/login/recover?next=driver");
    mock.api.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ token: "sms-token", driver: {
      id: "driver", name: "架空のドライバー", role: "DRIVER", capabilities: [],
    } }).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ complete: true, kycVerified: true });
    render(<RecoverPage />);
    await finishSmsLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("登録状態を確認できませんでした");
    expect(mock.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "もう一度確認する" }));
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/submit"));
    expect(mock.api.mock.calls.filter(([path]) => path === "/api/auth/recover/verify")).toHaveLength(1);
  });
});
