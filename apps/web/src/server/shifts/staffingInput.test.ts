import { describe, expect, it } from "vitest";
import { parseStaffingInput } from "./staffingInput";

const ctx = { allowedFrames: new Set(["c1|0", "c1|1"]) };
const requirement = (over: Record<string, unknown> = {}) => ({
  date: "2026-09-21",
  courseId: "c1",
  cycleNo: 1,
  state: "working",
  requiredCount: 2,
  ...over,
});

describe("parseStaffingInput", () => {
  it("動く日は人数必須、休み・未確定は人数を持たない", () => {
    expect(parseStaffingInput({ requirements: [requirement()] }, ctx)).toMatchObject({ ok: true });
    expect(parseStaffingInput({ requirements: [requirement({ requiredCount: undefined })] }, ctx)).toMatchObject({ ok: false });
    const closed = parseStaffingInput({ requirements: [requirement({ state: "closed", requiredCount: 3 })] }, ctx);
    expect(closed).toMatchObject({ ok: true });
    if (closed.ok) expect(closed.requirements[0].requiredCount).toBeNull();
  });

  it("0人は有効な指定", () => {
    const result = parseStaffingInput({ requirements: [requirement({ requiredCount: 0 })] }, ctx);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.requirements[0].requiredCount).toBe(0);
  });

  it("state=null はその指定を消す", () => {
    const result = parseStaffingInput({ requirements: [requirement({ state: null, requiredCount: null })] }, ctx);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.requirements[0].state).toBeNull();
  });

  it("自社にないコース・便は拒否", () => {
    expect(parseStaffingInput({ requirements: [requirement({ courseId: "other" })] }, ctx)).toMatchObject({ ok: false });
    expect(parseStaffingInput({ requirements: [requirement({ cycleNo: 9 })] }, ctx)).toMatchObject({ ok: false });
  });

  it("日付・曜日・人数の範囲外を拒否", () => {
    expect(parseStaffingInput({ requirements: [requirement({ date: "2026/09/21" })] }, ctx)).toMatchObject({ ok: false });
    expect(parseStaffingInput({ requirements: [requirement({ requiredCount: 51 })] }, ctx)).toMatchObject({ ok: false });
    expect(parseStaffingInput({ baselines: [{ courseId: "c1", cycleNo: 1, weekday: 7, state: "working", requiredCount: 1 }] }, ctx)).toMatchObject({ ok: false });
  });

  it("曜日の基準に未確定は置けない", () => {
    expect(parseStaffingInput({ baselines: [{ courseId: "c1", cycleNo: 1, weekday: 1, state: "undecided", requiredCount: null }] }, ctx)).toMatchObject({ ok: false });
  });

  it("同じ日・コース・便の重複を拒否", () => {
    expect(parseStaffingInput({ requirements: [requirement(), requirement({ requiredCount: 3 })] }, ctx)).toMatchObject({ ok: false });
  });

  it("空の要求は拒否", () => {
    expect(parseStaffingInput({ requirements: [], baselines: [] }, ctx)).toMatchObject({ ok: false });
    expect(parseStaffingInput(null, ctx)).toMatchObject({ ok: false });
  });
});
