import { useState } from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpCodeInput } from "./OtpCodeInput";
function Form() {
  const [value, setValue] = useState("");
  return <OtpCodeInput value={value} onChange={setValue} />;
}
it("6マスでも入力は一つ。6桁の貼り付け・矢印キー・削除で編集できる", async () => {
  const user = userEvent.setup(); render(<Form />);
  const input = screen.getByLabelText("認証コード");
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await user.click(input); await user.paste("123456");
  expect(input).toHaveValue("123456");
  expect(Array.from(input.parentElement!.firstElementChild!.children).map(cell => cell.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
  await user.keyboard("{End}{ArrowLeft}{Backspace}");
  expect(input).toHaveValue("12346");
  await user.keyboard("5"); expect(input).toHaveValue("123456");
});
it("一部入力した状態でも、6桁を貼り付けると全マスを置き換える", async () => {
  const user = userEvent.setup(); render(<Form />);
  const input = screen.getByLabelText("認証コード");
  await user.type(input, "9"); await user.paste("123 456");
  expect(input).toHaveValue("123456");
  expect((input as HTMLInputElement).selectionStart).toBe(6);
});
it("数字があるマスをクリックしても最後の1桁までBackspaceで削除できる", async () => {
  const user = userEvent.setup(); render(<Form />);
  const input = screen.getByLabelText("認証コード") as HTMLInputElement;
  await user.type(input, "8");
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue({ left: 0, width: 360 } as DOMRect);
  fireEvent.click(input, { clientX: 30 });
  expect(input.selectionStart).toBe(1);
  await user.keyboard("{Backspace}");
  expect(input).toHaveValue("");
  await user.paste("123456");
  await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
  expect(input).toHaveValue("");
});
it("数字以外は入れず、認証成功は入力を止めて6マスにチェックを表示する", async () => {
  const user = userEvent.setup(); const { rerender } = render(<Form />);
  await user.type(screen.getByLabelText("認証コード"), "1a2b3");
  expect(screen.getByLabelText("認証コード")).toHaveValue("123");
  rerender(<OtpCodeInput value="123456" onChange={() => {}} confirmed />);
  expect(screen.getByLabelText("認証コード")).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("電話番号を確認しました");
  expect(screen.getByLabelText("認証コード").parentElement?.querySelectorAll('svg')).toHaveLength(6);
});

it("全角6桁の貼り付けとIME確定は半角へ揃える", async () => {
  const user = userEvent.setup(); render(<Form />);
  const input = screen.getByLabelText("認証コード");
  await user.click(input); await user.paste("１２３４５６"); expect(input).toHaveValue("123456");
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: "８" } });
  fireEvent.compositionEnd(input, { target: { value: "８" } }); expect(input).toHaveValue("8");
});
