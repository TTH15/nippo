import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mock = vi.hoisted(() => ({
  api: vi.fn(), push: vi.fn(), replace: vi.fn(), setLoginSession: vi.fn(), authenticate: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mock.push, replace: mock.replace }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: mock.authenticate }));
vi.mock("@/lib/api", () => ({
  apiFetch: mock.api, setLoginSession: mock.setLoginSession,
  getStoredDriver: () => ({ id: "driver-1", role: "ADMIN", capabilities: ["admin.access"] }),
}));
vi.mock("@/lib/capabilities", () => ({ canEnterAdmin: () => true }));
vi.mock("@/lib/webauthnHost", () => ({ useIsWebAuthnHost: () => true }));
import LoginPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/login");
  mock.api.mockImplementation(async (path: string) => path.endsWith("/options")
    ? { options: {}, challengeToken: "test-challenge" }
    : { token: "driver-token", adminToken: null, driver: { id: "driver-1", name: "テスト", role: "ADMIN" } });
  mock.authenticate.mockResolvedValue({ id: "test-passkey" });
});
afterEach(cleanup);

describe("ログイン入口", () => {
  it("入口の選択までは認証操作を表示しない", () => {
    render(<LoginPage />);
    const desktop = within(document.querySelector(".login-scene") as HTMLElement);
    expect(desktop.getByRole("button", { name: "ドライバー画面を選ぶ" })).toBeVisible();
    expect(desktop.getByRole("button", { name: "運営画面を選ぶ" })).toBeVisible();
    expect(desktop.queryByRole("button", { name: "パスキーでログイン" })).toBeNull();
    expect(within(document.querySelector(".login-mobile") as HTMLElement).getByRole("button", { name: "パスキーでログイン" })).toBeEnabled();
    expect(screen.queryByText("使う画面を選ぶ")).toBeNull();
    expect(screen.queryByText("日報・シフト")).toBeNull();
    expect(screen.queryByText("配車・請求")).toBeNull();
  });

  it("運営を選ぶとPasskeyを主操作、電話番号を復旧導線にする", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "運営画面を選ぶ" }));
    const desktop = within(document.querySelector(".login-scene") as HTMLElement);
    expect(mock.replace).toHaveBeenCalledWith("/login?next=admin");
    expect(desktop.getByRole("button", { name: "パスキーでログイン" })).toBeEnabled();
    expect(desktop.getByRole("link", { name: "パスキーを設定・復旧する" })).toHaveAttribute("href", "/login/recover?next=admin");
    fireEvent.click(desktop.getByRole("button", { name: "選び直す" }));
    expect(desktop.queryByRole("button", { name: "パスキーでログイン" })).toBeNull();
  });

  it("ドライバー入口では電話番号ログインを選べる", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "ドライバー画面を選ぶ" }));
    expect(within(document.querySelector(".login-scene") as HTMLElement).getByRole("link", { name: /電話番号でログイン/ })).toHaveAttribute("href", "/login/recover?next=driver");
  });

  it("スマホ通常入口はドライバーに直行し、運営の選択を出さない", () => {
    render(<LoginPage />);
    const mobile = within(document.querySelector(".login-mobile") as HTMLElement);
    expect(mobile.queryByRole("heading", { name: "ドライバー" })).toBeNull();
    expect(mobile.getByText("または")).toBeVisible();
    expect(mobile.getByRole("link", { name: /電話番号でログイン/ })).toHaveAttribute("href", "/login/recover?next=driver");
    expect(mobile.queryByRole("button", { name: "運営画面を選ぶ" })).toBeNull();
  });

  it("運営への直リンクでも権限のないPasskeyは運営画面へ通さない", async () => {
    window.history.replaceState(null, "", "/login?next=admin");
    render(<LoginPage />);
    const mobile = within(document.querySelector(".login-mobile") as HTMLElement);
    expect(mobile.getByRole("heading", { name: "運営" })).toBeVisible();
    expect(mobile.queryByText("または")).toBeNull();
    expect(mobile.getByRole("link", { name: "パスキーを設定・復旧する" })).toHaveAttribute("href", "/login/recover?next=admin");
    fireEvent.click(mobile.getByRole("button", { name: "パスキーでログイン" }));
    await waitFor(() => expect(mobile.getByRole("alert")).toHaveTextContent("運営画面の権限がありません"));
    expect(mock.push).not.toHaveBeenCalledWith("/admin");
  });
});
