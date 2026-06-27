import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvoiceDocument } from "./InvoiceDocument";
import { toInvoiceDocData } from "./invoiceAdapter";

describe("InvoiceDocument", () => {
  const invoice = {
    id: "i1",
    invoiceNo: "INV-202505-AMZ-R01",
    clientName: "テスト株式会社",
    payload: {
      toName: "テスト株式会社",
      fromName: "株式会社ACE CREATION",
      parties: { fromParty: "ace_creation" },
      period: "2025年5月1日〜2025年5月31日",
      taxSettings: { enabled: true, rate: 10 },
      loanRepay: 5000,
      extraOutsourcing: 2000,
      tableData: {
        main: [{ title: "Amazon", qty: 1, unit: "回", price: 100000 }],
        deduct: [{ title: "リース代", qty: 1, unit: "件", price: 30000 }],
      },
      dueDate: "2025年6月30日",
      bankName: "京都信用金庫 梅津支店",
    },
  };

  it("主要セクションと差引き請求額を表示する", () => {
    render(<InvoiceDocument data={toInvoiceDocData(invoice)} />);
    expect(screen.getByText("御 請 求 書")).toBeInTheDocument();
    expect(screen.getByText("請求分")).toBeInTheDocument();
    expect(screen.getByText("お支払い分")).toBeInTheDocument();
    expect(screen.getByText("差引き請求額")).toBeInTheDocument();
    // 110000 − 33000 − 5000 + 2000 = 74,000（差引き請求額の行 + ご請求金額見出し）
    expect(screen.getAllByText(/74,000/).length).toBeGreaterThan(0);
    // マイナス項目に ▲ が付く
    expect(screen.getAllByText(/▲33,000/).length).toBeGreaterThan(0);
  });

  it("旧 payload（unit/period 無し）でも落ちない", () => {
    const legacy = {
      id: "i2",
      invoiceNo: "INV-OLD",
      payload: {
        subject: "2025年4月分",
        tableData: { main: [{ title: "X", qty: 2, price: 500 }], deduct: [] },
      },
    };
    render(<InvoiceDocument data={toInvoiceDocData(legacy)} />);
    expect(screen.getByText("差引き請求額")).toBeInTheDocument();
  });
});
