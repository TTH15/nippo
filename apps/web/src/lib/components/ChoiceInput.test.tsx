import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChoiceInput } from "./ChoiceInput";
import type { ChoiceValue } from "@/lib/formBuilder/choiceAnswers";

afterEach(cleanup);

function Example({ multiple = false, allowOther = true }: { multiple?: boolean; allowOther?: boolean }) {
  const [value, setValue] = useState<ChoiceValue>(multiple ? [] : "");
  return <><ChoiceInput label="方法" options={[{ value: "bank", label: "振込" }, { value: "other", label: "通常のその他" }]} value={value} onChange={setValue} multiple={multiple} allowOther={allowOther}/><output data-testid="answer">{JSON.stringify(value)}</output></>;
}

it("その他の選択時に入力欄を開き、通常項目へ戻ると自由入力を回答から外す", async () => {
  render(<Example/>);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "その他（自由入力）" }));
  const input = screen.getByRole("textbox", { name: "方法のその他の内容" });
  expect(input).toBeRequired();
  fireEvent.change(input, { target: { value: "手渡し" } });
  expect(screen.getByTestId("answer")).toHaveTextContent('{"selected":[],"other":"手渡し"}');
  fireEvent.click(screen.getByRole("radio", { name: "振込" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByTestId("answer")).toHaveTextContent('"bank"');
  await waitFor(() => expect(screen.queryByLabelText("方法のその他の内容")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("radio", { name: "その他（自由入力）" }));
  expect(screen.getByRole("textbox")).toHaveValue("");
});

it("複数選択では通常項目と自由入力を併用し、解除しても通常項目を残す", () => {
  render(<Example multiple/>);
  fireEvent.click(screen.getByRole("checkbox", { name: "振込" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "その他（自由入力）" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "手渡し" } });
  expect(screen.getByTestId("answer")).toHaveTextContent('{"selected":["bank"],"other":"手渡し"}');
  fireEvent.click(screen.getByRole("checkbox", { name: "その他（自由入力）" }));
  expect(screen.getByTestId("answer")).toHaveTextContent('["bank"]');
});

it("通常のその他ラベルは勝手に自由入力へ変換しない", () => {
  render(<Example allowOther={false}/>);
  fireEvent.click(screen.getByRole("radio", { name: "通常のその他" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByTestId("answer")).toHaveTextContent('"other"');
  fireEvent.click(screen.getByRole("button", { name: "選択をクリア" }));
  expect(screen.getByTestId("answer")).toHaveTextContent('""');
});
