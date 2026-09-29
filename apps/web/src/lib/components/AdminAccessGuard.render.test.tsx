import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({ replace: vi.fn(), renew: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mock.replace }),
  usePathname: () => "/admin",
}));
vi.mock("@/lib/api", () => ({
  getStoredDriver: () => ({ id: "driver-a", role: "ADMIN", capabilities: ["admin.access"] }),
  getAdminToken: () => null,
  renewAdminToken: mock.renew,
}));
vi.mock("@/lib/capabilities", () => ({ canEnterAdmin: () => true }));
vi.mock("@/lib/useSyncSession", () => ({ useSyncSession: () => "done" }));

import { AdminAccessGuard } from "./AdminAccessGuard";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("運営画面のセッション復元", () => {
  it("Cookieから更新できればPasskey画面に戻さない", async () => {
    mock.renew.mockResolvedValue("renewed-admin-token");
    render(<AdminAccessGuard><p>運営画面</p></AdminAccessGuard>);
    expect(await screen.findByText("運営画面")).toBeVisible();
    expect(mock.replace).not.toHaveBeenCalled();
  });

  it("一時的な通信失敗ではログアウトせず再試行できる", async () => {
    mock.renew.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("renewed-admin-token");
    render(<AdminAccessGuard><p>運営画面</p></AdminAccessGuard>);
    fireEvent.click(await screen.findByRole("button", { name: "再試行" }));
    await waitFor(() => expect(screen.getByText("運営画面")).toBeVisible());
    expect(mock.replace).not.toHaveBeenCalled();
  });
});
