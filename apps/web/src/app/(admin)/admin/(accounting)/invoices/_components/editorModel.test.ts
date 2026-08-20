import { describe, it, expect } from "vitest";
import { getInvoiceIssuer } from "@/config/companies";
import {
  blankEditorState,
  editorFromInvoice,
  amountFromEditor,
  payloadFromEditor,
  saveBodyFromEditor,
  defaultTargetPeriod,
  isDriverRecipient,
  validateForSave,
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
      main: [{ title: "A", qty: "1", unit: "回", price: "100000", priceBasis: "exclusive" }],
      deduct: [{ title: "B", qty: "1", unit: "件", price: "30000", priceBasis: "exclusive" }],
      taxRatePercent: "10",
      loanRepay: "5000",
      extraOutsourcingExclusive: "2000",
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
        { title: "A", qty: "2", unit: "回", price: "100", priceBasis: "exclusive" },
        { title: "", qty: "", unit: "", price: "", priceBasis: "exclusive" },
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
  it("旧形式の発行請求書でも既定の印影を復元する", () => {
    const st = editorFromInvoice({
      id: "legacy-outgoing",
      direction: "outgoing",
      invoiceNo: "INV-OLD",
      payload: { fromName: "株式会社エースクリエイション" },
    });
    expect(st.showStamp).toBe(Boolean(getInvoiceIssuer().stampPath));
  });

  it("売上請求書は過去の非表示設定が残っていても会社設定の印影を復元する", () => {
    const st = editorFromInvoice({
      id: "no-stamp",
      direction: "outgoing",
      invoiceNo: "INV-NO-STAMP",
      payload: { showStamp: false },
    });
    expect(st.showStamp).toBe(Boolean(getInvoiceIssuer().stampPath));
  });

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

  it("アップロード請求書の attachments/source が編集保存で消えない（2026-08-14 データ欠落バグの回帰）", () => {
    const st = editorFromInvoice({
      id: "up1",
      payload: {
        source: "uploaded_document",
        billAmountDisplay: "¥0",
        issueDate: "2026年8月31日",
        attachments: [
          // 詳細GETは閲覧用の署名URL（url）を付けて返す
          { name: "a.pdf", type: "application/pdf", path: "org/x.pdf", url: "https://signed.example/x" },
        ],
        parties: { fromParty: "drv-abc", toParty: "ace_creation" },
        tableData: { main: [], deduct: [] },
      },
    });
    const p = payloadFromEditor(st) as Record<string, unknown>;
    // エディタが管理しないキーは保存 payload にそのまま残る
    expect(p.source).toBe("uploaded_document");
    expect(p.billAmountDisplay).toBe("¥0");
    expect(p.issueDate).toBe("2026年8月31日");
    const atts = p.attachments as Record<string, unknown>[];
    expect(atts).toHaveLength(1);
    expect(atts[0].path).toBe("org/x.pdf");
    expect(atts[0].name).toBe("a.pdf");
    // 閲覧用の一時署名URLは保存しない
    expect(atts[0].url).toBeUndefined();
  });

  it("passthrough は管理キーを上書きしない（編集内容が優先）", () => {
    const st = editorFromInvoice({
      id: "up2",
      payload: {
        source: "uploaded_document",
        notes: "旧メモ",
        parties: { fromParty: "drv-abc", toParty: "ace_creation" },
      },
    });
    const p = payloadFromEditor({ ...st, notes: "編集後メモ" }) as Record<string, unknown>;
    expect(p.notes).toBe("編集後メモ");
    expect(p.source).toBe("uploaded_document");
  });

  it("旧iframe保存の payload（subject/単価のみ）でも編集に展開される", () => {
    const st = editorFromInvoice({
      id: "old1",
      clientName: "旧取引先",
      payload: {
        toName: "旧取引先",
        subject: "2025年4月1日〜2025年4月30日",
        taxSettings: { enabled: true, rate: 10 },
        parties: { fromParty: "ace_creation", toParty: "corp-9" },
        tableData: {
          main: [{ title: "ヤマト", qty: 100, price: 150 }],
          deduct: [{ title: "リース", qty: 1, price: 39091 }],
        },
      },
    });
    expect(st.toName).toBe("旧取引先");
    expect(st.period).toBe("2025年4月1日〜2025年4月30日");
    expect(st.main).toHaveLength(1);
    expect(st.main[0].title).toBe("ヤマト");
    expect(st.main[0].qty).toBe("100");
    expect(st.deduct[0].title).toBe("リース");
  });
});

describe("自社 → ドライバー個人の請求書", () => {
  const driverRecipient = (): EditorState => ({
    ...blankEditorState("outgoing"),
    toName: "山田太郎",
    honorific: "様",
    parties: { fromParty: "ace_creation", toParty: "drv-abc" },
    main: [{ title: "車両リース料", qty: "1", unit: "式", price: "30000", priceBasis: "exclusive" }],
  });

  it("kind は売上請求書のまま（受領と誤判定しない）", () => {
    const st = editorFromInvoice({
      payload: { parties: { fromParty: "ace_creation", toParty: "drv-abc" } },
    });
    expect(st.kind).toBe("outgoing");
    expect(isDriverRecipient(st)).toBe(true);
  });

  it("法人アドレス（取引先ID）が無くても保存できる", () => {
    const st = driverRecipient();
    expect(st.counterpartyInvoiceAddressId).toBeNull();
    expect(validateForSave(st)).toEqual([]);
  });

  it("取引先宛は従来どおり取引先IDを要求する", () => {
    const st: EditorState = {
      ...driverRecipient(),
      toName: "合同会社テスト",
      parties: { fromParty: "ace_creation", toParty: "" },
    };
    expect(isDriverRecipient(st)).toBe(false);
    expect(validateForSave(st).some((e) => e.includes("請求先（取引先）"))).toBe(true);
  });

  it("clientName はドライバー名（一覧のフォルダ名になる）", () => {
    const body = saveBodyFromEditor(driverRecipient()) as {
      clientName: string;
      counterpartyInvoiceAddressId: string | null;
    };
    expect(body.clientName).toBe("山田太郎");
    expect(body.counterpartyInvoiceAddressId).toBeNull();
  });
});
