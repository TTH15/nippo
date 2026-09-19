import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PasskeySetup } from "./PasskeySetup";

afterEach(cleanup);

describe("Passkey登録の半必須導線", () => {
  it("最初は登録が主操作で、SMS続行は明示的に開く", async () => {
    const register = vi.fn();
    const next = vi.fn();
    render(<PasskeySetup supported register={register} onContinue={next} />);
    expect(screen.getByRole("button", { name: "Passkeyを登録する" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /SMSでログインする方法で進む/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "この端末では設定できない" }));
    fireEvent.click(await screen.findByRole("button", { name: "SMSでログインする方法で進む" }));
    expect(next).toHaveBeenCalledWith(false);
    expect(register).not.toHaveBeenCalled();
  });
  it("サーバー登録が成功した後にだけ登録済みで進む", async () => {
    const next = vi.fn();
    render(<PasskeySetup supported register={vi.fn().mockResolvedValue(undefined)} onContinue={next} />);
    fireEvent.click(screen.getByRole("button", { name: "Passkeyを登録する" }));
    expect(await screen.findByRole("status")).toHaveTextContent("登録しました");
    expect(next).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(next).toHaveBeenCalledWith(true);
  });
  it("キャンセル・失敗では進まず、再試行で成功できる", async () => {
    const next = vi.fn();
    const register = vi.fn().mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError")).mockResolvedValueOnce(undefined);
    render(<PasskeySetup supported register={register} onContinue={next} />);
    fireEvent.click(screen.getByRole("button", { name: "Passkeyを登録する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("登録が完了しませんでした");
    expect(next).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "もう一度登録する" }));
    expect(await screen.findByRole("status")).toHaveTextContent("登録しました");
  });
  it("非対応の環境では登録を呼ばずにSMSを選べる", async () => {
    const register = vi.fn();
    render(<PasskeySetup supported={false} register={register} onContinue={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Passkeyを登録する" })).toBeNull();
    expect(screen.getByText(/この環境ではPasskeyを登録できません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この端末では設定できない" }));
    expect(await screen.findByRole("button", { name: "SMSでログインする方法で進む" })).toBeEnabled();
    expect(register).not.toHaveBeenCalled();
  });
  it("登録処理中は重複操作とSMS切替を抑止する", () => {
    render(<PasskeySetup supported register={() => new Promise(() => {})} onContinue={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Passkeyを登録する" }));
    expect(screen.getByRole("button", { name: "登録中..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "この端末では設定できない" })).toBeDisabled();
  });
});
