import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DriverSetupGate, DriverSetupPanel } from "./DriverSetupGate";
const m = vi.hoisted(() => ({ api: vi.fn(), passkey: vi.fn(), verified: false, phone: "09000000000", hasKey: true,
  bank: { bankName: "", bankNo: "", bankHolder: "", bankBranch: "", bankType: "" }, failRead: false, failSave: false, persistPhone: true }));
vi.mock("@/lib/api", () => ({ apiFetch: m.api }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: m.passkey }));
vi.mock("@/lib/webauthnHost", () => ({ useIsWebAuthnHost: () => true }));
const readyBank = { bankName: "見本銀行", bankBranch: "中央支店", bankType: "ordinary", bankNo: "1234567", bankHolder: "ミホン タロウ" };
beforeEach(() => {
  sessionStorage.removeItem("nippo_phone_resend_after");
  m.verified = false; m.phone = "09000000000"; m.hasKey = true; m.bank = { bankName: "", bankNo: "", bankHolder: "", bankBranch: "", bankType: "" };
  m.failRead = false; m.failSave = false; m.persistPhone = true; m.passkey.mockReset().mockResolvedValue({ id: "key" });
  m.api.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (!init?.method && m.failRead) throw new Error("read failed");
    if (path === "/api/reports/profile") return { name: "見本 太郎", phone: m.phone, phoneVerified: m.verified };
    if (path === "/api/me/registration" && !init?.method) return { ...m.bank, hasPasskey: m.hasKey };
    if (path === "/api/auth/reauth/options") return { options: {}, challengeToken: "bank-challenge" };
    if (path === "/api/auth/reauth/verify") return { bankChangeToken: "bank-proof" };
    if (path === "/api/me/registration") {
      if (m.failSave) throw new Error("保存できませんでした");
      m.bank = JSON.parse(String(init?.body)); return { ok: true };
    }
    if (path === "/api/me/phone/verify") {
      const payload = JSON.parse(String(init?.body));
      if (payload.code !== "123456") throw new Error("認証コードが正しくありません");
      if (m.persistPhone) { m.verified = true; m.phone = payload.phone; }
    }
    return { ok: true };
  });
});
function gate() { render(<DriverSetupGate><div>通常の業務画面</div></DriverSetupGate>); }
async function fillBank(scope: Pick<typeof screen, "findByLabelText" | "getByLabelText"> = screen) {
  fireEvent.change(await scope.findByLabelText("銀行名"), { target: { value: readyBank.bankName } });
  fireEvent.change(scope.getByLabelText("支店名"), { target: { value: "中央支店" } });
  fireEvent.click(scope.getByLabelText("口座種別"));
  fireEvent.click(screen.getByRole("button", { name: "普通" }));
  fireEvent.change(scope.getByLabelText("口座番号"), { target: { value: "01234567" } });
  fireEvent.change(scope.getByLabelText("口座名義（カナ）"), { target: { value: readyBank.bankHolder } });
}
it("両方未完了なら電話入力の1ページ目だけを表示し、進捗2点と背景を残す", async () => {
  gate(); await screen.findByLabelText("電話番号");
  expect(screen.queryByLabelText("口座番号")).toBeNull();
  expect(screen.getByLabelText("登録の進み具合")).toHaveTextContent("1 / 2");
  expect(screen.queryByLabelText("認証コード")).toBeNull();
  expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).toHaveAttribute("inert");
  expect(screen.queryByRole("button", { name: "ログアウト" })).toBeNull();
  const dialog = screen.getByRole("dialog"); fireEvent.keyDown(document, { key: "Escape" }); fireEvent.click(dialog.parentElement!);
  expect(dialog).toBeInTheDocument();
});
it.each(["phone", "bank"])("%sだけ未完了なら1ページ・進捗1点", async step => {
  if (step === "phone") m.bank = readyBank; else m.verified = true;
  gate(); await screen.findByLabelText(step === "phone" ? "電話番号" : "口座番号");
  expect(screen.getByLabelText("登録の進み具合")).toHaveTextContent("1 / 1");
});
it("両方登録済みならモーダルを省略する", async () => {
  m.verified = true; m.bank = readyBank; gate();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(screen.getByText("通常の業務画面").closest("[data-driver-setup-background]")).not.toHaveAttribute("inert"));
});
it("取得失敗では入力を開始せず再読み込みできる", async () => {
  m.failRead = true; gate(); await screen.findByText("登録状況を確認できませんでした。");
  expect(screen.queryByLabelText("電話番号")).toBeNull();
  m.failRead = false; fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
  await screen.findByLabelText("電話番号");
});
it("新しい電話を入力し、SMS誤コードから復帰して口座ページへ進み初回登録を完了する", async () => {
  m.phone = ""; gate(); fireEvent.change(await screen.findByLabelText("電話番号"), { target: { value: "09000000001" } });
  fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
  fireEvent.change(await screen.findByLabelText("認証コード"), { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "電話番号を確認" }));
  await screen.findByText("認証コードが正しくありません");
  fireEvent.change(screen.getByLabelText("認証コード"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "電話番号を確認" }));
  await screen.findByRole("status");
  expect(screen.getByRole("button", { name: "確認しました" })).toBeDisabled();
  expect(screen.queryByLabelText("口座番号")).toBeNull();
  await fillBank(); expect(screen.queryByLabelText("電話番号")).toBeNull();
  expect(screen.getByLabelText("登録の進み具合")).toHaveTextContent("2 / 2");
  fireEvent.click(screen.getByRole("button", { name: "口座を登録して利用を開始" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(m.bank.bankNo).toBe("01234567"); expect(m.passkey).not.toHaveBeenCalled();
});
it("SMSが成功してもサーバーが未確認なら口座ページへ進めない", async () => {
  m.persistPhone = false; gate(); fireEvent.click(await screen.findByRole("button", { name: "認証コードを送信" }));
  fireEvent.change(await screen.findByLabelText("認証コード"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "電話番号を確認" }));
  await screen.findByText("電話番号の確認状況を再読み込みしてください");
  expect(screen.queryByLabelText("口座番号")).toBeNull();
});
it("初回口座の保存失敗は入力を保持し、再保存で完了する", async () => {
  m.verified = true; m.failSave = true; gate(); await fillBank();
  fireEvent.click(screen.getByRole("button", { name: "口座を登録して利用を開始" }));
  await screen.findByText("保存できませんでした"); expect(screen.getByLabelText("口座番号")).toHaveValue("01234567");
  m.failSave = false; fireEvent.click(screen.getByRole("button", { name: "口座を登録して利用を開始" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
async function openChange() {
  m.verified = true; m.bank = { ...readyBank }; render(<DriverSetupPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "振込口座を変更" }));
  const modal = within(await screen.findByRole("dialog", { name: "振込口座を変更" }));
  return modal;
}
it("口座変更は独立モーダルで内容を確認し、毎回パスキーを検証して専用確認情報を添える", async () => {
  const modal = await openChange(); await fillBank(modal);
  expect(m.passkey).not.toHaveBeenCalled();
  fireEvent.click(modal.getByRole("button", { name: "変更内容を確認" }));
  const review = within(await screen.findByRole("dialog", { name: "変更内容の確認" }));
  expect(review.getByText("01234567")).toBeInTheDocument();
  fireEvent.click(review.getByRole("button", { name: "パスキーで確認して変更" }));
  await screen.findByText("振込口座を変更しました"); expect(m.passkey).toHaveBeenCalledOnce();
  expect(m.api).toHaveBeenCalledWith("/api/me/registration", expect.objectContaining({ method: "POST", headers: { "x-bank-change-token": "bank-proof" } }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("パスキー中止では保存しない。内容を保持し再確認できる", async () => {
  m.passkey.mockRejectedValueOnce(Object.assign(new Error("cancel"), { name: "NotAllowedError" }));
  const modal = await openChange(); await fillBank(modal); fireEvent.click(modal.getByRole("button", { name: "変更内容を確認" }));
  fireEvent.click(screen.getByRole("button", { name: "パスキーで確認して変更" }));
  await screen.findByText("パスキーの確認を中止しました。変更内容は残っています。");
  expect(m.api.mock.calls.some(([path, init]) => path === "/api/me/registration" && init?.method === "POST")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "パスキーで確認して変更" }));
  await screen.findByText("振込口座を変更しました"); expect(m.passkey).toHaveBeenCalledTimes(2);
});
it("パスキー未登録の口座は変更フォームを開かない", async () => {
  m.hasKey = false; await openChange();
  await screen.findByText("口座を変更するには、パスキーの設定が必要です。");
  expect(screen.queryByRole("button", { name: "変更内容を確認" })).toBeNull();
});

it("口座登録済みなら電話の確認済み表示後に自動で利用を開始する", async () => {
  m.bank = readyBank; gate();
  fireEvent.click(await screen.findByRole("button", { name: "認証コードを送信" }));
  fireEvent.change(await screen.findByLabelText("認証コード"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "電話番号を確認" }));
  await screen.findByRole("button", { name: "確認しました" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("番号を入力し直すとコード欄を閉じて番号編集に戻る", async () => {
  gate(); fireEvent.click(await screen.findByRole("button", { name: "認証コードを送信" }));
  fireEvent.change(await screen.findByLabelText("認証コード"), { target: { value: "12" } });
  expect(screen.queryByLabelText("電話番号")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "番号を入力し直す" }));
  expect(screen.getByLabelText("電話番号")).toBeEnabled();
  await waitFor(() => expect(screen.queryByLabelText("認証コード")).toBeNull());
  expect(screen.getByRole("button", { name: /送信まであと/ })).toBeDisabled();
});
it("SMS送信失敗では60秒待機を開始せず、そのまま再試行できる", async () => {
  gate(); await screen.findByLabelText("電話番号");
  m.api.mockRejectedValueOnce(new Error("認証コードの送信に失敗しました"));
  fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
  await screen.findByText("認証コードの送信に失敗しました");
  expect(screen.getByRole("button", { name: "認証コードを送信" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
  await screen.findByLabelText("認証コード");
  expect(screen.getByRole("button", { name: /再送まであと/ })).toBeDisabled();
});
