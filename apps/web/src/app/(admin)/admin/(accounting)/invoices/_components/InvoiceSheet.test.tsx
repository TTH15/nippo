import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvoiceSheet } from "./InvoiceSheet";
import { blankEditorState, type EditorState } from "./editorModel";

function sample(): EditorState {
  return {
    ...blankEditorState("outgoing"),
    toName: "テスト株式会社",
    main: [{ title: "Amazon", qty: "1", unit: "回", price: "100000" }],
    deduct: [{ title: "リース代", qty: "1", unit: "件", price: "30000" }],
    loanRepay: "5000",
    extraOutsourcing: "2000",
  };
}

describe("InvoiceSheet", () => {
  it("readOnly：主要セクションと差引き請求額を表示（テキスト）", () => {
    render(<InvoiceSheet state={sample()} readOnly />);
    expect(screen.getByText("御 請 求 書")).toBeInTheDocument();
    expect(screen.getByText("請求分")).toBeInTheDocument();
    expect(screen.getByText("お支払い分")).toBeInTheDocument();
    expect(screen.getByText("差引き請求額")).toBeInTheDocument();
    // 110000 − 33000 − 5000 + 2000 = 74,000
    expect(screen.getAllByText(/74,000/).length).toBeGreaterThan(0);
    // readOnly では入力欄を出さない
    expect(screen.queryByPlaceholderText("摘要")).toBeNull();
  });

  it("編集モード：明細などがインライン入力欄になる", () => {
    render(<InvoiceSheet state={sample()} onChange={() => {}} />);
    // 摘要セルが input（placeholder=摘要）として描画される
    expect(screen.getAllByPlaceholderText("摘要").length).toBeGreaterThan(0);
    expect(screen.getByText("差引き請求額")).toBeInTheDocument();
  });
});
