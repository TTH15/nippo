import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DriverSetupGate, DriverSetupPanel } from "./DriverSetupGate";
const m = vi.hoisted(() => ({ api: vi.fn(), verified: false, bank: { bankName: "", bankNo: "", bankHolder: "" }, failRead: false, failSave: false, persistPhone: true }));
vi.mock("@/lib/api", () => ({ apiFetch: m.api, clearAuth: vi.fn() }));
vi.mock("@/lib/components/SmoothCollapse", () => ({ SmoothCollapse: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null }));
beforeEach(() => {
  m.verified = false; m.bank = { bankName: "", bankNo: "", bankHolder: "" }; m.failRead = false; m.failSave = false; m.persistPhone = true;
  m.api.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (!init?.method && m.failRead) throw new Error("read failed");
    if (path === "/api/reports/profile") return { name: "見本 太郎", phone: "09000000000", phoneVerified: m.verified };
    if (path === "/api/me/registration" && !init?.method) return { ...m.bank };
    if (path === "/api/me/registration") {
      if (m.failSave) throw new Error("保存できませんでした");
      m.bank = JSON.parse(String(init?.body)); return { ok: true };
    }
    if (path === "/api/me/phone/verify") {
      if (JSON.parse(String(init?.body)).code !== "123456") throw new Error("認証コードが正しくありません");
      if (m.persistPhone) m.verified = true;
      return { ok: true };
    }
    return { ok: true };
  });
});
const readyBank = { bankName: "見本銀行 中央支店", bankNo: "1234567", bankHolder: "ミホン タロウ" };
function gate() { render(<DriverSetupGate><div>通常の業務画面</div></DriverSetupGate>); }
async function fillBank() {
  fireEvent.change(await screen.findByLabelText("銀行名・支店"), { target: { value: readyBank.bankName } });
  fireEvent.change(screen.getByLabelText("口座番号"), { target: { value: readyBank.bankNo } });
  fireEvent.change(screen.getByLabelText("口座名義（カナ）"), { target: { value: readyBank.bankHolder } });
}
describe("利用開始前の登録確認", () => {
  it.each([[false, false], [true, false], [false, true]])("電話=%s・口座=%sの未完了では通常画面の上にモーダルを出す", async (phone, bank) => {
    m.verified = phone; if (bank) m.bank = readyBank;
    gate(); await screen.findByText("090-0000-0000");
    expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "利用を開始する" })).toBeDisabled();
  });
  it("背景クリックやEscapeで未完了モーダルを閉じない", async () => {
    gate(); const dialog = await screen.findByRole("dialog", { name: "利用開始の準備" });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編集を閉じる" })).toBeNull();
    expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).toHaveAttribute("aria-hidden", "true");
  });
  it("両方登録済みならそのまま業務画面へ進む", async () => {
    m.verified = true; m.bank = readyBank; gate();
    await waitFor(() => expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).not.toHaveAttribute("inert"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("取得失敗を未登録と扱わず、再読み込みで復帰する", async () => {
    m.failRead = true; gate(); await screen.findByText("登録状況を確認できませんでした。");
    expect(screen.queryByLabelText("銀行名・支店")).toBeNull();
    m.failRead = false; fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await screen.findByLabelText("銀行名・支店");
    expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).toHaveAttribute("inert");
  });
  it("保存失敗は入力を保持し、再保存とSMS確認がそろってから進む", async () => {
    gate(); await fillBank(); m.failSave = true;
    fireEvent.click(screen.getByRole("button", { name: "振込口座を保存" }));
    await screen.findByText("保存できませんでした");
    expect(screen.getByLabelText("口座番号")).toHaveValue("1234567");
    m.failSave = false; fireEvent.click(screen.getByRole("button", { name: "振込口座を保存" }));
    await screen.findByText("振込口座を保存しました");
    fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
    fireEvent.change(await screen.findByLabelText("認証コード"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "確認する" }));
    await screen.findByText("認証コードが正しくありません");
    fireEvent.change(screen.getByLabelText("認証コード"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "確認する" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "利用を開始する" })).toBeEnabled());
    expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "利用を開始する" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).not.toHaveAttribute("inert");
  });
  it("モーダル完了後のマイページにも確認済みの状態を反映する", async () => {
    m.bank = readyBank;
    render(<DriverSetupGate><DriverSetupPanel /></DriverSetupGate>);
    const modal = within(await screen.findByRole("dialog", { name: "利用開始の準備" }));
    fireEvent.click(await modal.findByRole("button", { name: "認証コードを送信" }));
    fireEvent.change(await modal.findByLabelText("認証コード"), { target: { value: "123456" } });
    fireEvent.click(modal.getByRole("button", { name: "確認する" }));
    await waitFor(() => expect(modal.getByRole("button", { name: "利用を開始する" })).toBeEnabled());
    fireEvent.click(modal.getByRole("button", { name: "利用を開始する" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getAllByText("完了")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "認証コードを送信" })).toBeNull();
  });
  it("SMS APIが成功しても取得結果が未確認なら進めない", async () => {
    m.bank = readyBank; m.persistPhone = false; gate();
    fireEvent.click(await screen.findByRole("button", { name: "認証コードを送信" }));
    fireEvent.change(await screen.findByLabelText("認証コード"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "確認する" }));
    await screen.findByText("電話番号の確認状況を再読み込みしてください");
    expect(screen.getByRole("button", { name: "利用を開始する" })).toBeDisabled();
  });
  it("保存後の状態取得に失敗した場合、再読み込みまで進めない", async () => {
    m.verified = true; gate(); await fillBank();
    const previous = m.api.getMockImplementation()!;
    m.api.mockImplementation(async (path: string, init?: RequestInit) => {
      const result = await previous(path, init);
      if (init?.method === "POST") m.failRead = true;
      return result;
    });
    fireEvent.click(screen.getByRole("button", { name: "振込口座を保存" }));
    await screen.findByText("登録状況を確認できませんでした。");
    expect(screen.getByLabelText("口座番号")).toHaveValue("1234567");
    expect(screen.getByRole("button", { name: "利用を開始する" })).toBeDisabled();
    m.failRead = false; fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "利用を開始する" })).toBeEnabled());
  });
  it("既存仕様の8桁口座と先頭の0を保持する", async () => {
    gate(); await fillBank(); fireEvent.change(screen.getByLabelText("口座番号"), { target: { value: "01234567" } });
    fireEvent.click(screen.getByRole("button", { name: "振込口座を保存" }));
    await screen.findByText("振込口座を保存しました");
    expect(m.bank.bankNo).toBe("01234567");
  });
  it("マイページは口座を隠し、編集で登録値を表示する", async () => {
    m.verified = true; m.bank = readyBank; render(<DriverSetupPanel />);
    await screen.findByText("末尾 4567");
    expect(screen.queryByLabelText("口座番号")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    expect(screen.getByLabelText("口座番号")).toHaveValue("1234567");
  });
});
