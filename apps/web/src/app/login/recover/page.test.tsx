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
vi.mock("@/lib/components/PasskeySetup", () => ({
  PasskeySetup: ({ required }: { required: boolean }) => <div data-testid="passkey-setup" data-required={required} />,
}));
import RecoverPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
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
});
