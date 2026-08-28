import { describe, expect, it } from "vitest";
import { normalizeRateVersion, selectEffectiveVersion, validateRateVersion, type RateVersionData } from "./rateVersion";

const base = (over: Partial<RateVersionData> = {}): RateVersionData => ({
  version: 2,
  revenueRateMode: "PER_PIECE",
  payoutRateMode: "PER_PIECE",
  taxBasis: { revenuePiece: "exclusive", payoutPiece: "exclusive", revenueFixed: "exclusive", payoutFixed: "exclusive" },
  unitRates: [],
  fixedRates: [],
  fixedBundle: null,
  ...over,
});

describe("normalizeRateVersion（旧形式の取り込み）", () => {
  it("契約額が未保存の行は、税抜額をそのまま契約額として扱う", () => {
    // コースの税基準(inclusive)を当てると税抜136円を税込とみなし約10%目減りする
    const v1 = {
      revenuePieceTaxBasis: "inclusive",
      payoutPieceTaxBasis: "inclusive",
      unitRates: [{ cycle_no: 0, unit_id: "u1", revenue_per_unit: 145, payout_per_unit: 136 }],
    };
    const v2 = normalizeRateVersion(v1)!;
    expect(v2.unitRates[0].revenue).toEqual({ contract: 145, exclusive: 145 });
    expect(v2.unitRates[0].payout).toEqual({ contract: 136, exclusive: 136 });
  });

  it("契約額があれば契約額と税抜額を別々に持つ", () => {
    const v2 = normalizeRateVersion({
      revenuePieceTaxBasis: "inclusive",
      unitRates: [{ cycle_no: 0, unit_id: "u1", revenue_per_unit: 145, revenue_contract_amount: 160, payout_per_unit: 136, payout_contract_amount: 136 }],
    })!;
    expect(v2.unitRates[0].revenue).toEqual({ contract: 160, exclusive: 145 });
  });

  it("旧 revenue_tax_basis しか無い版は4区分へ展開する", () => {
    const v2 = normalizeRateVersion({ revenueTaxBasis: "inclusive", payoutTaxBasis: "exclusive" })!;
    expect(v2.taxBasis).toEqual({
      revenuePiece: "inclusive", payoutPiece: "exclusive",
      revenueFixed: "inclusive", payoutFixed: "exclusive",
    });
  });

  it("すでに v2 ならそのまま返す", () => {
    const v2 = base();
    expect(normalizeRateVersion(v2)).toBe(v2);
  });
});

describe("validateRateVersion", () => {
  it("税込160円・税抜145円のような意図的な差は通す", () => {
    const issues = validateRateVersion(base({
      taxBasis: { revenuePiece: "inclusive", payoutPiece: "exclusive", revenueFixed: "exclusive", payoutFixed: "exclusive" },
      unitRates: [{ cycleNo: 0, unitId: "u1", revenue: { contract: 160, exclusive: 145 }, payout: { contract: 136, exclusive: 136 } }],
    }));
    expect(issues).toEqual([]);
  });

  it("税込契約なのに税抜が大きく離れていたら警告する", () => {
    // 西宇治の履歴に残っていた「税抜15円」のような誤値を拾う
    const issues = validateRateVersion(base({
      taxBasis: { revenuePiece: "inclusive", payoutPiece: "exclusive", revenueFixed: "exclusive", payoutFixed: "exclusive" },
      unitRates: [{ cycleNo: 0, unitId: "u1", revenue: { contract: 160, exclusive: 15 }, payout: { contract: 0, exclusive: 0 } }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "warning", label: "歩合売上" });
  });

  it("税抜契約なのに契約額と税抜額が違えば警告する", () => {
    const issues = validateRateVersion(base({
      unitRates: [{ cycleNo: 0, unitId: "u1", revenue: { contract: 157.5, exclusive: 145 }, payout: { contract: 0, exclusive: 0 } }],
    }));
    expect(issues[0]).toMatchObject({ level: "warning", label: "歩合売上" });
  });

  it("マイナス単価は保存を止める", () => {
    const issues = validateRateVersion(base({
      unitRates: [{ cycleNo: 0, unitId: "u1", revenue: { contract: -1, exclusive: -1 }, payout: { contract: 0, exclusive: 0 } }],
    }));
    expect(issues[0].level).toBe("error");
  });

  it("前回から50%超動く場合は確認を促す", () => {
    const previous = base({
      unitRates: [{ cycleNo: 0, unitId: "u1", revenue: { contract: 157, exclusive: 157 }, payout: { contract: 136, exclusive: 136 } }],
    });
    const next = base({
      unitRates: [{ cycleNo: 0, unitId: "u1", revenue: { contract: 15, exclusive: 15 }, payout: { contract: 136, exclusive: 136 } }],
    });
    const issues = validateRateVersion(next, previous);
    expect(issues.some((i) => i.level === "warning" && i.message.includes("動きます"))).toBe(true);
  });

  it("0円のまま（契約なし）は何も言わない", () => {
    expect(validateRateVersion(base({
      unitRates: [{ cycleNo: 0, unitId: "u1", revenue: { contract: 0, exclusive: 0 }, payout: { contract: 0, exclusive: 0 } }],
    }))).toEqual([]);
  });
});

describe("selectEffectiveVersion", () => {
  const versions = [
    { effective_from: "2026-07-31", invalid_reason: "税抜額が契約額と乖離" },
    { effective_from: "2026-08-14", invalid_reason: null },
    { effective_from: "2026-08-26", invalid_reason: null },
  ];

  it("その日以前で最も新しい版を選ぶ", () => {
    expect(selectEffectiveVersion(versions, "2026-08-20")?.effective_from).toBe("2026-08-14");
    expect(selectEffectiveVersion(versions, "2026-08-26")?.effective_from).toBe("2026-08-26");
  });

  it("検証に落ちた版は使わない", () => {
    // 7/31版は誤値として隔離済みなので、8/5時点では適用できる版が無い
    expect(selectEffectiveVersion(versions, "2026-08-05")).toBeNull();
  });
});
