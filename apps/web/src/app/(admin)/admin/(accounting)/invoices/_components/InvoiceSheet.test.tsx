import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvoiceSheet } from "./InvoiceSheet";
import { blankEditorState, type EditorState } from "./editorModel";
import { getInvoiceIssuer } from "@/config/companies";

function Harness({ init }: { init: EditorState }) {
  const [st, setSt] = useState(init);
  return <InvoiceSheet state={st} onChange={setSt} />;
}

function sample(): EditorState {
  return {
    ...blankEditorState("outgoing"),
    toName: "テスト株式会社",
    main: [{ title: "Amazon", qty: "1", unit: "回", price: "100000", priceBasis: "exclusive" }],
    deduct: [{ title: "リース代", qty: "1", unit: "件", price: "30000", priceBasis: "exclusive" }],
    loanRepay: "5000",
    extraOutsourcingExclusive: "2000",
  };
}

describe("InvoiceSheet", () => {
  it("発行請求書に設定済みの印影画像を表示する", () => {
    const { container } = render(<InvoiceSheet state={{ ...sample(), showStamp: false }} readOnly />);
    const stamp = container.querySelector(`img[src="${getInvoiceIssuer().stampPath}"]`);
    expect(stamp).not.toBeNull();
  });

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
    const { container } = render(
      <Harness init={{ ...blankEditorState("outgoing"), main: [{ title: "", qty: "", unit: "", price: "", priceBasis: "exclusive" }], deduct: [] }} />,
    );
    const title = screen.getByPlaceholderText("摘要");
    await user.click(title);
    await user.type(title, "ネコポス");
    expect((title as HTMLInputElement).value).toBe("ネコポス");
    // 数量に複数桁。placeholder="0" はサマリー欄（貸付返済等、初期値"0"）にもあり
    // DOM 順で先に来るため、data-cell で明細1行目の数量セルを正確に指す。
    const qty = container.querySelector('[data-cell="main|0|1"]') as HTMLInputElement;
    expect(qty).not.toBeNull();
    await user.click(qty);
    await user.type(qty, "254");
    expect(qty.value).toBe("254");
  });

  it("矢印キーで上下左右のセルへフォーカス移動する（data-cell属性でセルを特定できる）", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness
        init={{
          ...blankEditorState("outgoing"),
          main: [
            { title: "行1", qty: "1", unit: "個", price: "100", priceBasis: "exclusive" },
            { title: "行2", qty: "2", unit: "個", price: "200", priceBasis: "exclusive" },
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

  describe("宛先の電話・登録番号（2026-08-18）", () => {
    it("readOnly：請求先の電話と登録番号を出す", () => {
      render(
        <InvoiceSheet
          state={{ ...sample(), toTel: "075-000-0000", toReg: "T1234567890123" }}
          readOnly
        />,
      );
      expect(screen.getByText("電話：075-000-0000")).toBeInTheDocument();
      expect(screen.getByText("登録番号：T1234567890123")).toBeInTheDocument();
    });

    it("readOnly：登録番号が空ならラベルごと出さない（受領請求書のドライバー等）", () => {
      const st = { ...sample(), toTel: "", toReg: "", fromReg: "", fromTel: "" };
      render(<InvoiceSheet state={st} readOnly />);
      expect(screen.queryByText(/登録番号：/)).toBeNull();
      expect(screen.queryByText(/電話：/)).toBeNull();
    });

    it("編集モード：空の登録番号の行は印刷から外す（hide-print）", () => {
      const { container } = render(
        <InvoiceSheet state={{ ...sample(), toReg: "" }} onChange={() => {}} />,
      );
      const labels = Array.from(container.querySelectorAll("span")).filter(
        (el) => el.textContent === "登録番号：",
      );
      expect(labels.length).toBeGreaterThan(0);
      // 空欄の行は画面には出す（入力できるように）が、印刷では消える
      expect(labels.some((el) => el.parentElement?.className.includes("hide-print"))).toBe(true);
    });

    it("住所欄は内容に合わせて伸びる（rows 固定で切らない）", () => {
      const st = { ...sample(), toAddrHtml: "〒600-0000<br/>京都府京都市中京区<br/>〇〇通△△下ル□□町1-2-3<br/>××ビル 5F" };
      const { container } = render(<InvoiceSheet state={st} onChange={() => {}} />);
      const area = Array.from(container.querySelectorAll("textarea")).find((el) =>
        el.value.includes("××ビル"),
      );
      expect(area).toBeTruthy();
      // 4行の住所が textarea の value にすべて入っている（切り捨てられていない）
      expect(area!.value.split("\n")).toHaveLength(4);
      expect(Number(area!.rows)).toBe(1); // 高さは scrollHeight で伸ばすので rows は 1 固定
    });
  });
});
