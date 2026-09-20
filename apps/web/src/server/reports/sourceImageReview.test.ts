import { describe, expect, it } from "vitest";
import { flagDuplicates, mergeReadingValues, reviewReasons } from "./sourceImageReview";
import type { ImageTemplateDefinition } from "@repo/core/logic/reportImageTemplate";

// ============================================================
// 管理側の確認材料の組み立て。ここでは良し悪しを判定せず、見るべき点を並べるだけ。
// ============================================================

const definition = {
  match: { required: [] },
  fields: [
    {
      id: "done",
      unitId: "unit-1",
      fieldKey: "completed",
      label: "宅急便 配完",
      value: { type: "int" as const },
      locator: { kind: "region" as const, rect: { x: 0, y: 0, w: 10, h: 10 } },
      required: true,
    },
  ],
} as unknown as ImageTemplateDefinition;

describe("同じ画像の使い回し", () => {
  it("別の人が同じ画像を出していれば両方に印を付ける", () => {
    const flags = flagDuplicates([
      { id: "a", driverId: "d1", reportDate: "2026-09-19", sha256: "x" },
      { id: "b", driverId: "d2", reportDate: "2026-09-19", sha256: "x" },
    ]);
    expect(flags.a).toBe("other_driver");
    expect(flags.b).toBe("other_driver");
  });

  it("同じ人の別の日なら別日として印を付ける", () => {
    const flags = flagDuplicates([
      { id: "a", driverId: "d1", reportDate: "2026-09-18", sha256: "x" },
      { id: "b", driverId: "d1", reportDate: "2026-09-19", sha256: "x" },
    ]);
    expect(flags.a).toBe("other_date");
  });

  it("1枚しかない画像には印を付けない", () => {
    expect(flagDuplicates([{ id: "a", driverId: "d1", reportDate: "2026-09-19", sha256: "x" }]).a).toBe("none");
  });
});

describe("読み取り値と確認後の値", () => {
  it("項目ごとに読み取りと確認後を並べ、直した項目が分かる", () => {
    const values = mergeReadingValues(
      { fields: [{ fieldId: "done", value: 44, status: "read", confidence: 0.96 }] },
      { fields: [{ fieldId: "done", unitId: "unit-1", fieldKey: "completed", value: 45 }] },
      definition,
    );
    expect(values[0]).toMatchObject({ label: "宅急便 配完", read: 44, confirmed: 45, corrected: true });
  });

  it("様式が消えていても値は出す", () => {
    const values = mergeReadingValues({ fields: [{ fieldId: "done", value: 44 }] }, null, null);
    expect(values[0]).toMatchObject({ label: null, read: 44, confirmed: null, corrected: false });
  });

  it("読めなかった項目を0で埋めない", () => {
    const values = mergeReadingValues({ fields: [{ fieldId: "done", value: null, status: "not_found" }] }, null, definition);
    expect(values[0].read).toBeNull();
    expect(values[0].status).toBe("not_found");
  });
});

describe("確認すべき点", () => {
  const base = {
    id: "a",
    reportDate: "2026-09-19",
    status: "confirmed",
    capturedAt: null,
    capturedAtSource: "unknown" as const,
    duplicate: "none" as const,
    readDate: null,
    values: [],
  };

  it("手がかりが無い普通の提出では何も並べない", () => {
    expect(reviewReasons(base)).toEqual([]);
  });

  it("別の人の提出と同じ画像なら並べる", () => {
    expect(reviewReasons({ ...base, duplicate: "other_driver" }).join()).toContain("別の人");
  });

  it("本人が直した項目数を出す", () => {
    const reasons = reviewReasons({
      ...base,
      values: [{ fieldId: "done", label: "配完", read: 44, confirmed: 45, status: "read", confidence: 0.9, corrected: true }],
    });
    expect(reasons.join()).toContain("1件");
  });

  it("確定していない提出は確定待ちとして出す", () => {
    expect(reviewReasons({ ...base, status: "needs_review" }).join()).toContain("確定していません");
  });
});
