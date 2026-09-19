import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mock = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn(), setAuth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/lib/api", () => ({ apiFetch: mock.api, setAuth: mock.setAuth, getStoredDriver: () => ({ role: "DRIVER" }) }));
vi.mock("@/lib/webauthnHost", () => ({ useIsWebAuthnHost: () => true }));
import LoginPage from "./page";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
describe("招待ユーザーのログイン入口", () => {
  it("最初はPIN欄を出さずPasskeyとSMSを表示する", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: "Passkeyでログイン" })).toBeEnabled();
    expect(screen.getByRole("link", { name: /電話番号でログイン/ })).toHaveAttribute("href", "/login/recover");
    expect(screen.queryByLabelText("PIN")).toBeNull();
  });
  it("旧PINログインへ戻る操作を表示しない", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("button", { name: "以前の番号でログイン" })).toBeNull();
    expect(screen.queryByLabelText("PIN")).toBeNull();
  });
});
