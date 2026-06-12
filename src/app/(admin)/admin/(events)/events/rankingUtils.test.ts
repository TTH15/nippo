import { describe, it, expect } from "vitest";
import { applyPointDelta, tieRanks, medalForRank } from "./rankingUtils";
import type { RankingResponse } from "./types";

// ────────────────────────────────────────────────────────────
// テストフィクスチャ
// ────────────────────────────────────────────────────────────

const makeRanking = (): RankingResponse => ({
  driverNames: { d1: "田中", d2: "鈴木", d3: "佐藤" },
  individuals: [
    { driverId: "d1", teamId: "t1", autoPoints: 100, manualPoints: 0, total: 100, breakdown: [] },
    { driverId: "d2", teamId: "t1", autoPoints: 80, manualPoints: 0, total: 80, breakdown: [] },
    { driverId: "d3", teamId: "t2", autoPoints: 60, manualPoints: 0, total: 60, breakdown: [] },
  ],
  teams: [
    {
      teamId: "t1",
      name: "チームA",
      color: "#ff0000",
      memberPoints: 180,
      teamManualPoints: 0,
      total: 180,
      members: [
        { driverId: "d1", teamId: "t1", autoPoints: 100, manualPoints: 0, total: 100, breakdown: [] },
        { driverId: "d2", teamId: "t1", autoPoints: 80, manualPoints: 0, total: 80, breakdown: [] },
      ],
    },
    {
      teamId: "t2",
      name: "チームB",
      color: "#0000ff",
      memberPoints: 60,
      teamManualPoints: 0,
      total: 60,
      members: [
        { driverId: "d3", teamId: "t2", autoPoints: 60, manualPoints: 0, total: 60, breakdown: [] },
      ],
    },
  ],
});

// ────────────────────────────────────────────────────────────
// medalForRank
// ────────────────────────────────────────────────────────────

describe("medalForRank", () => {
  it("1位はゴールドメダル", () => expect(medalForRank(1)).toBe("🥇"));
  it("2位はシルバーメダル", () => expect(medalForRank(2)).toBe("🥈"));
  it("3位はブロンズメダル", () => expect(medalForRank(3)).toBe("🥉"));
  it("4位以降は数字", () => {
    expect(medalForRank(4)).toBe("4");
    expect(medalForRank(10)).toBe("10");
  });
});

// ────────────────────────────────────────────────────────────
// tieRanks
// ────────────────────────────────────────────────────────────

describe("tieRanks", () => {
  it("全員異なるスコア → 1,2,3", () => {
    expect(tieRanks([{ total: 100 }, { total: 80 }, { total: 60 }])).toEqual([1, 2, 3]);
  });

  it("先頭2人が同点 → 1,1,3", () => {
    expect(tieRanks([{ total: 100 }, { total: 100 }, { total: 60 }])).toEqual([1, 1, 3]);
  });

  it("全員同点 → 1,1,1", () => {
    expect(tieRanks([{ total: 50 }, { total: 50 }, { total: 50 }])).toEqual([1, 1, 1]);
  });

  it("2位と3位が同点 → 1,2,2", () => {
    expect(tieRanks([{ total: 100 }, { total: 50 }, { total: 50 }])).toEqual([1, 2, 2]);
  });

  it("空配列 → []", () => {
    expect(tieRanks([])).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// applyPointDelta — ドライバーへの加点
// ────────────────────────────────────────────────────────────

describe("applyPointDelta（ドライバー加点）", () => {
  it("個人スコアの manualPoints / total が増加する", () => {
    const result = applyPointDelta(makeRanking(), "d1", null, 20);
    const d1 = result.individuals.find((d) => d.driverId === "d1")!;
    expect(d1.manualPoints).toBe(20);
    expect(d1.total).toBe(120);
  });

  it("所属チームの memberPoints / total が増加する", () => {
    const result = applyPointDelta(makeRanking(), "d1", null, 20);
    const t1 = result.teams.find((t) => t.teamId === "t1")!;
    expect(t1.memberPoints).toBe(200);
    expect(t1.total).toBe(200);
  });

  it("チーム内メンバーのスコアも更新される", () => {
    const result = applyPointDelta(makeRanking(), "d1", null, 20);
    const t1 = result.teams.find((t) => t.teamId === "t1")!;
    const member = t1.members.find((m) => m.driverId === "d1")!;
    expect(member.manualPoints).toBe(20);
    expect(member.total).toBe(120);
  });

  it("他のドライバー・チームは変わらない", () => {
    const before = makeRanking();
    const result = applyPointDelta(before, "d1", null, 20);
    const d2 = result.individuals.find((d) => d.driverId === "d2")!;
    expect(d2.total).toBe(80);
    const t2 = result.teams.find((t) => t.teamId === "t2")!;
    expect(t2.total).toBe(60);
  });

  it("減点（マイナス値）でスコアが下がる", () => {
    const result = applyPointDelta(makeRanking(), "d2", null, -30);
    const d2 = result.individuals.find((d) => d.driverId === "d2")!;
    expect(d2.manualPoints).toBe(-30);
    expect(d2.total).toBe(50);
  });

  it("加点後に個人ランキングが降順で並び替えられる", () => {
    // d2(80pt) に +50 → d2(130pt) が d1(100pt) を抜いて1位になる
    const result = applyPointDelta(makeRanking(), "d2", null, 50);
    expect(result.individuals[0].driverId).toBe("d2");
    expect(result.individuals[1].driverId).toBe("d1");
  });

  it("加点後にチームランキングが降順で並び替えられる", () => {
    // d3(60pt) に +200 → t2(260pt) が t1(180pt) を抜いて1位になる
    const result = applyPointDelta(makeRanking(), "d3", null, 200);
    expect(result.teams[0].teamId).toBe("t2");
    expect(result.teams[1].teamId).toBe("t1");
  });
});

// ────────────────────────────────────────────────────────────
// applyPointDelta — チームへの加点
// ────────────────────────────────────────────────────────────

describe("applyPointDelta（チーム加点）", () => {
  it("チームの teamManualPoints / total が増加する", () => {
    const result = applyPointDelta(makeRanking(), null, "t2", 50);
    const t2 = result.teams.find((t) => t.teamId === "t2")!;
    expect(t2.teamManualPoints).toBe(50);
    expect(t2.total).toBe(110);
  });

  it("チームの memberPoints は変わらない", () => {
    const result = applyPointDelta(makeRanking(), null, "t2", 50);
    const t2 = result.teams.find((t) => t.teamId === "t2")!;
    expect(t2.memberPoints).toBe(60);
  });

  it("個人ランキングは変わらない", () => {
    const before = makeRanking();
    const result = applyPointDelta(before, null, "t2", 50);
    expect(result.individuals).toEqual(before.individuals);
  });

  it("チーム加点後に順位が入れ替わる", () => {
    // t2(60pt) に +200 → t2(260pt) が 1位になる
    const result = applyPointDelta(makeRanking(), null, "t2", 200);
    expect(result.teams[0].teamId).toBe("t2");
  });
});

// ────────────────────────────────────────────────────────────
// applyPointDelta — イミュータビリティ
// ────────────────────────────────────────────────────────────

describe("applyPointDelta（小数の累積誤差）", () => {
  it("0.1pt 加点後に total が浮動小数の誤差を持たない", () => {
    // d2(80) に 0.1 → 80.1。さらに別途 0.2 を足しても誤差が出ないこと
    const once = applyPointDelta(makeRanking(), "d2", null, 0.1);
    const twice = applyPointDelta(once, "d2", null, 0.2);
    const d2 = twice.individuals.find((d) => d.driverId === "d2")!;
    expect(d2.total).toBe(80.3); // 80.30000000000001 にならない
    expect(d2.manualPoints).toBe(0.3);
  });
});

describe("applyPointDelta（イミュータビリティ）", () => {
  it("元の ranking オブジェクトを変更しない", () => {
    const original = makeRanking();
    const originalD1Total = original.individuals[0].total;
    applyPointDelta(original, "d1", null, 99);
    expect(original.individuals[0].total).toBe(originalD1Total);
  });
});
