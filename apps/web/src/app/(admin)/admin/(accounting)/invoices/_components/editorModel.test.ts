import { describe, it, expect } from "vitest";
import { getInvoiceIssuer } from "@/config/companies";
import {
  blankEditorState,
  editorFromInvoice,
  amountFromEditor,
  payloadFromEditor,
  saveBodyFromEditor,
  defaultTargetPeriod,
  type EditorState,
} from "./editorModel";

describe("blankEditorState", () => {
  it("outgoing は自社が請求元・対象期間を補完", () => {
    const st = blankEditorState("outgoing");
    expect(st.parties.fromParty).toBe("ace_creation");
    expect(st.fromName).toBe(getInvoiceIssuer().name);
    expect(st.showStamp).toBe(Boolean(getInvoiceIssuer().stampPath));
    expect(st.period).not.toBe("");
  });
  it("incoming は自社が請求先・印鑑なし", () => {
    const st = blankEditorState("incoming");
    expect(st.parties.toParty).toBe("ace_creation");
    expect(st.toName).toBe(getInvoiceIssuer().name);
    expect(st.showStamp).toBe(false);
  });
});

describe("defaultTargetPeriod", () => {
  it("前月の1日〜末日（うるう年2月）", () => {
    expect(defaultTargetPeriod(new Date(2024, 2, 15))).toBe("2024年2月1日〜2024年2月29日");
  });
  it("年跨ぎ（1月→前年12月）", () => {
    expect(defaultTargetPeriod(new Date(2025, 0, 10))).toBe("2024年12月1日〜2024年12月31日");
  });
});

describe("amountFromEditor", () => {
  it("差引き＝請求-お支払い-借入返済+追加外注", () => {
    const st: EditorState = {
      ...blankEditorState("outgoing"),
      main: [{ title: "A", qty: "1", unit: "回", price: "100000" }],
      deduct: [{ title: "B", qty: "1", unit: "件", price: "30000" }],
      taxRatePercent: "10",
      loanRepay: "5000",
      extraOutsourcing: "2000",
    };
    // 110000 - 33000 - 5000 + 2000
    expect(amountFromEditor(st)).toBe(74000);
  });
});

describe("payloadFromEditor", () => {
  it("空行は除外し unit を保持", () => {
    const st: EditorState = {
      ...blankEditorState("outgoing"),
      main: [
        { title: "A", qty: "2", unit: "回", price: "100" },
        { title: "", qty: "", unit: "", price: "" },
      ],
      deduct: [],
    };
    const p = payloadFromEditor(st) as { tableData: { main: unknown[]; deduct: unknown[] } };
    expect(p.tableData.main).toHaveLength(1);
    expect((p.tableData.main[0] as { unit: string }).unit).toBe("回");
    expect(p.tableData.deduct).toHaveLength(0);
  });
});

describe("editorFromInvoice → saveBodyFromEditor 往復", () => {
  it("kind/明細/金額を保持", () => {
    const inv = {
      id: "i1",
      invoiceNo: "INV-1",
      section: "Amazon",
      status: "draft" as const,
      counterpartyInvoiceAddressId: "cp1",
      payload: {
        parties: { fromParty: "ace_creation", toParty: "corp-x" },
        tableData: { main: [{ title: "X", qty: 2, unit: "件", price: 500 }], deduct: [] },
        taxSettings: { enabled: true, rate: 10 },
      },
    };
    const st = editorFromInvoice(inv);
    expect(st.kind).toBe("outgoing");
    expect(st.main).toHaveLength(1);
    expect(st.main[0].unit).toBe("件");
    const body = saveBodyFromEditor(st) as { id: string; amount: number };
    expect(body.id).toBe("i1");
    expect(body.amount).toBe(1100); // 1000 + 10%
  });

  it("受領（ドライバー→自社）を推定", () => {
    const st = editorFromInvoice({
      payload: { parties: { fromParty: "drv-abc", toParty: "ace_creation" } },
    });
    expect(st.kind).toBe("incoming");
  });
});
