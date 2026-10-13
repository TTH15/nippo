import { useState } from "react";
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
  await user.keyboard("{End}{ArrowLeft}{Backspace}");
  expect(input).toHaveValue("12346");
  await user.keyboard("5"); expect(input).toHaveValue("123456");
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
