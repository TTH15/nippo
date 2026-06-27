import { describe, it, expect } from "vitest";
import {
  formatYen,
  logLabel,
  formatLogLine,
  mergedDetails,
  isUploadedDocument,
  pendingInvoices,
  rowAmount,
  parseRow,
  sumRows,
  invoiceLines,
  roundedRowAmount,
  sumRowsRounded,
  computeInvoiceTotals,
} from "./reward";
import type { RewardLogDetail, RewardsSummary, MyInvoice } from "../types";

function log(log_date: string, amount: number, content = "", type_name = ""): RewardLogDetail {
  return { log_date, amount, content, type_name };
}

function inv(over: Partial<MyInvoice>): MyInvoice {
  return {
    id: "i1",
    month: "2026-06",
    issueDate: "2026-06-30",
    amount: 0,
    status: "pending_approval",
    invoiceNo: "No.1",
    payload: {},
    ...over,
  };
}

describe("formatYen", () => {
  it("正値は3桁区切り＋円", () => {
    expect(formatYen(1234567)).toBe("1,234,567円");
  });
  it("負値は -N円", () => {
    expect(formatYen(-5000)).toBe("-5,000円");
  });
  it("0円", () => {
    expect(formatYen(0)).toBe("0円");
  });
});

describe("logLabel", () => {
  it("content > type_name > —", () => {
    expect(logLabel(log("2026-06-01", 0, "手当", "賞与"))).toBe("手当");
    expect(logLabel(log("2026-06-01", 0, "", "賞与"))).toBe("賞与");
    expect(logLabel(log("2026-06-01", 0, "", ""))).toBe("—");
  });
});

describe("formatLogLine", () => {
  it("M月D日 ラベル 金額 を結合", () => {
    expect(formatLogLine(log("2026-06-05", -300, "高速代"))).toBe("6月5日 高速代 -300円");
  });
});

describe("mergedDetails", () => {
  it("daily + manual を日付昇順に結合", () => {
    const rewards = {
      dailyIncomeDetails: [log("2026-06-10", 100), log("2026-06-02", 200)],
      logDetails: [log("2026-06-05", 50)],
    } as RewardsSummary;
    expect(mergedDetails(rewards).map((l) => l.log_date)).toEqual([
      "2026-06-02",
      "2026-06-05",
      "2026-06-10",
    ]);
  });
  it("配列が欠けていても落ちない", () => {
    expect(mergedDetails({} as RewardsSummary)).toEqual([]);
  });
});

describe("isUploadedDocument", () => {
  it("source が uploaded_document なら true", () => {
    expect(isUploadedDocument(inv({ payload: { source: "uploaded_document" } }))).toBe(true);
  });
  it("それ以外・payload 無しは false", () => {
    expect(isUploadedDocument(inv({ payload: { source: "billing" } }))).toBe(false);
    expect(isUploadedDocument(inv({ payload: null }))).toBe(false);
  });
});

describe("pendingInvoices", () => {
  it("pending_approval のみ残す", () => {
    const list = [
      inv({ id: "a", status: "pending_approval" }),
      inv({ id: "b", status: "approved" }),
      inv({ id: "c", status: "pending_approval" }),
    ];
    expect(pendingInvoices(list).map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("parseRow", () => {
  it("qty/price/amount を数値で返す", () => {
    expect(parseRow({ qty: "3", price: 100 })).toEqual({ qty: 3, price: 100, amount: 300 });
  });
  it("欠損は0", () => {
    expect(parseRow({})).toEqual({ qty: 0, price: 0, amount: 0 });
  });
});

describe("rowAmount / sumRows", () => {
  it("数量×単価。文字列も数値化", () => {
    expect(rowAmount({ qty: 3, price: 100 })).toBe(300);
    expect(rowAmount({ qty: "2", price: "150" })).toBe(300);
  });
  it("欠損・非数値は0", () => {
    expect(rowAmount({})).toBe(0);
    expect(rowAmount({ qty: "x", price: 100 })).toBe(0);
  });
  it("sumRows は合計", () => {
    expect(sumRows([{ qty: 2, price: 100 }, { qty: 1, price: 50 }])).toBe(250);
    expect(sumRows([])).toBe(0);
  });
});

describe("invoiceLines", () => {
  it("payload から main/deduct/attachments を取り出す", () => {
    const i = inv({
      payload: {
        tableData: { main: [{ qty: 1, price: 100 }], deduct: [{ qty: 1, price: 30 }] },
        attachments: [{ name: "a.pdf" }],
      },
    });
    const { main, deduct, attachments } = invoiceLines(i);
    expect(main).toHaveLength(1);
    expect(deduct).toHaveLength(1);
    expect(attachments).toHaveLength(1);
  });
  it("配列でなければ空配列に正規化", () => {
    const i = inv({ payload: { tableData: { main: "oops" } } });
    expect(invoiceLines(i)).toEqual({ main: [], deduct: [], attachments: [] });
  });
  it("payload 欠如でも落ちない", () => {
    expect(invoiceLines(inv({ payload: null }))).toEqual({ main: [], deduct: [], attachments: [] });
  });
});

describe("roundedRowAmount / sumRowsRounded", () => {
  it("行ごとに四捨五入（小数単価）", () => {
    expect(roundedRowAmount({ qty: 254, price: 27.3 })).toBe(6934); // 6934.2→6934
    expect(roundedRowAmount({ qty: 59, price: 27.3 })).toBe(1611); // 1610.7→1611
  });
  it("sumRowsRounded は各行四捨五入後の合算", () => {
    expect(sumRowsRounded([{ qty: 254, price: 27.3 }, { qty: 59, price: 27.3 }])).toBe(8545);
    expect(sumRowsRounded([])).toBe(0);
  });
});

describe("computeInvoiceTotals", () => {
  it("税抜単価モデル：請求−お支払い−借入返済+追加外注", () => {
    const t = computeInvoiceTotals({
      main: [{ qty: 1, price: 100000 }],
      deduct: [{ qty: 1, price: 30000 }],
      taxEnabled: true,
      taxRatePercent: 10,
      loanRepay: 5000,
      extraOutsourcing: 2000,
    });
    expect(t.billSubtotal).toBe(100000);
    expect(t.deductSubtotal).toBe(30000);
    expect(t.billTax).toBe(10000);
    expect(t.deductTax).toBe(3000);
    expect(t.billGross).toBe(110000);
    expect(t.deductGross).toBe(33000);
    // 110000 − 33000 − 5000 + 2000
    expect(t.total).toBe(74000);
  });

  it("消費税OFFなら税額0・総額は税抜差引き", () => {
    const t = computeInvoiceTotals({
      main: [{ qty: 2, price: 12727 }],
      deduct: [],
      taxEnabled: false,
      taxRatePercent: 10,
      loanRepay: 0,
      extraOutsourcing: 0,
    });
    expect(t.billTax).toBe(0);
    expect(t.deductTax).toBe(0);
    expect(t.total).toBe(25454);
  });

  it("小数単価は行ごと四捨五入してから税計算", () => {
    const t = computeInvoiceTotals({
      main: [{ qty: 254, price: 27.3 }, { qty: 1453, price: 136.36 }],
      deduct: [],
      taxEnabled: true,
      taxRatePercent: 10,
      loanRepay: 0,
      extraOutsourcing: 0,
    });
    // 6934 + 198131 = 205065, tax 20506.5→20507
    expect(t.billSubtotal).toBe(205065);
    expect(t.billTax).toBe(20507);
    expect(t.total).toBe(225572);
  });

  it("欠損入力でも落ちない（NaN→0）", () => {
    const t = computeInvoiceTotals({
      main: [],
      deduct: [],
      taxEnabled: true,
      taxRatePercent: 10,
      loanRepay: NaN as unknown as number,
      extraOutsourcing: NaN as unknown as number,
    });
    expect(t.total).toBe(0);
  });
});
