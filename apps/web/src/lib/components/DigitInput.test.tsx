import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DigitInput } from "./DigitInput";

function RequiredHarness() {
  const [value, setValue] = useState(0);
  return (
    <>
      <DigitInput value={value} onValueChange={(next) => setValue(next ?? 0)} className="" ariaLabel="金額" />
      <output>{value}</output>
    </>
  );
}

describe("DigitInput", () => {
  it("IME変換中は全角数字を保持し、確定時に半角へ補正する", () => {
    render(<RequiredHarness />);
    const input = screen.getByRole("textbox", { name: "金額" });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "１２３" } });
    expect(input).toHaveValue("１２３");
    expect(screen.getByText("0")).toBeInTheDocument();

    fireEvent.compositionEnd(input);
    expect(input).toHaveValue("123");
    expect(screen.getByText("123")).toBeInTheDocument();
  });

  it("貼り付け相当の全角入力は即座に半角へ補正する", () => {
    render(<RequiredHarness />);
    const input = screen.getByRole("textbox", { name: "金額" });

    fireEvent.change(input, { target: { value: "￥１２,３４５" } });
    expect(input).toHaveValue("12345");
    expect(screen.getByText("12345")).toBeInTheDocument();
  });

  it("IME変換中にフォーカスが外れても半角値を確定する", () => {
    render(<RequiredHarness />);
    const input = screen.getByRole("textbox", { name: "金額" });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "９８７" } });
    fireEvent.blur(input);

    expect(input).toHaveValue("987");
    expect(screen.getByText("987")).toBeInTheDocument();
  });
});
