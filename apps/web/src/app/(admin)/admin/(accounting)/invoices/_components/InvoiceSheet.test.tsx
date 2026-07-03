import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvoiceSheet } from "./InvoiceSheet";
import { blankEditorState, type EditorState } from "./editorModel";

function Harness({ init }: { init: EditorState }) {
  const [st, setSt] = useState(init);
  return <InvoiceSheet state={st} onChange={setSt} />;
}

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

  it("連続入力でフォーカスが外れない（複数桁を入力できる）", async () => {
    const user = userEvent.setup();
    render(<Harness init={{ ...blankEditorState("outgoing"), main: [{ title: "", qty: "", unit: "", price: "" }], deduct: [] }} />);
    const title = screen.getByPlaceholderText("摘要");
    await user.click(title);
    await user.type(title, "ネコポス");
    expect((title as HTMLInputElement).value).toBe("ネコポス");
    // 数量に複数桁
    const qty = screen.getAllByPlaceholderText("0")[0];
    await user.type(qty, "254");
    expect((qty as HTMLInputElement).value).toBe("254");
  });

  it("矢印キーで上下左右のセルへフォーカス移動する（data-cell属性でセルを特定できる）", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness
        init={{
          ...blankEditorState("outgoing"),
          main: [
            { title: "行1", qty: "1", unit: "個", price: "100" },
            { title: "行2", qty: "2", unit: "個", price: "200" },
          ],
          deduct: [],
        }}
      />,
    );
    const cell = (id: string) => container.querySelector(`[data-cell="${id}"]`) as HTMLInputElement;
    // data-cell 属性が実際にDOMへ出ていること（focusCellのquerySelectorが機能する前提）
    expect(cell("main|0|0")).not.toBeNull();

    await user.click(cell("main|0|0"));
    expect(document.activeElement).toBe(cell("main|0|0"));

    await user.keyboard("{ArrowDown}");
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(cell("main|1|0"));

    await user.keyboard("{ArrowUp}");
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(cell("main|0|0"));

    await user.keyboard("{ArrowRight}");
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(cell("main|0|1"));

    await user.keyboard("{ArrowLeft}");
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(cell("main|0|0"));
  });
});
