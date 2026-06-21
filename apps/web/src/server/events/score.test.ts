// check-event-scoring.ts（tsx 検証スクリプト）を Vitest へ移植し、
// 同点タイブレーク・空ルール・不正入力などのエッジケースを追加したもの。
import { describe, it, expect } from "vitest";
import { computeEventScores } from "./score";
import { normalizeScoringRuleSet, emptyScoringRuleSet } from "./types";
import type {
  ScoringRuleSet,
  EventTeam,
  EventMember,
  ManualPointEntry,
  ScoringReport,
} from "./types";

// ────────────────────────────────────────────────────────────
// フィクスチャ（check-event-scoring.ts と同一の合成データ）
// ────────────────────────────────────────────────────────────

const U_TAKKYU = "u-takkyu";
const U_NEKO = "u-neko";

const teams: EventTeam[] = [
  { id: "team-red", name: "赤組", color: "#ef4444", sortOrder: 1 },
  { id: "team-blue", name: "青組", color: "#3b82f6", sortOrder: 2 },
];

const members: EventMember[] = [
  { driverId: "d1", teamId: "team-red" },
  { driverId: "d2", teamId: "team-red" },
  { driverId: "d3", teamId: "team-blue" },
  // d4 は未所属（集計対象外）
];

// 完了個数 ×1（宅急便＋ネコポス横断）、持戻 ×-2（宅急便）
const scoringRule: ScoringRuleSet = {
  version: 1,
  rules: [
    {
      id: "r-completed",
      label: "完了個数",
      fields: [
        { unitId: U_TAKKYU, fieldKey: "completed" },
        { unitId: U_NEKO, fieldKey: "completed" },
      ],
      pointsPer: 1,
    },
    {
      id: "r-returned",
      label: "持戻",
      fields: [{ unitId: U_TAKKYU, fieldKey: "returned" }],
      pointsPer: -2,
    },
  ],
};

function report(
  driverId: string,
  approved: boolean,
  entries: { unitId: string; fieldKey: string; valueNum: number }[],
  rejected = false,
): ScoringReport {
  return {
    driverId,
    approvedAt: approved ? "2026-05-01T00:00:00Z" : null,
    rejectedAt: rejected ? "2026-05-02T00:00:00Z" : null,
    entries,
  };
}

const reports: ScoringReport[] = [
  // d1: 完了100(宅) + 完了20(ネコ) + 持戻5(宅) = 120 - 10 = 110
  report("d1", true, [
    { unitId: U_TAKKYU, fieldKey: "completed", valueNum: 100 },
    { unitId: U_NEKO, fieldKey: "completed", valueNum: 20 },
    { unitId: U_TAKKYU, fieldKey: "returned", valueNum: 5 },
  ]),
  // d2: 完了80(宅) = 80
  report("d2", true, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 80 }]),
  // d3: 完了200(宅) = 200
  report("d3", true, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 200 }]),
  // 承認なし（除外）
  report("d3", false, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 999 }]),
  // 却下（除外）
  report("d1", true, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 999 }], true),
  // 未所属 d4（集計対象外）
  report("d4", true, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 500 }]),
];

const manual: ManualPointEntry[] = [
  { driverId: "d2", teamId: null, points: 50, reason: "MVP", entryDate: null },
  { driverId: null, teamId: "team-blue", points: 30, reason: "ボーナス", entryDate: null },
  { driverId: "d4", teamId: null, points: 999, reason: "未所属は無視", entryDate: null },
];

const baseInput = { scoringRule, teams, members, reports, manualEntries: manual };

// ────────────────────────────────────────────────────────────
// computeEventScores — 基本採点（旧 check-event-scoring 相当）
// ────────────────────────────────────────────────────────────

describe("computeEventScores — 基本採点", () => {
  const res = computeEventScores(baseInput);

  it("自動採点: d1 = 完了120 − 持戻10 = 110", () => {
    const d1 = res.individuals.find((d) => d.driverId === "d1")!;
    expect(d1.autoPoints).toBe(110);
    expect(d1.manualPoints).toBe(0);
    expect(d1.total).toBe(110);
  });

  it("承認なし・却下の報告は除外される（d3 自動=200のみ）", () => {
    const d3 = res.individuals.find((d) => d.driverId === "d3")!;
    expect(d3.autoPoints).toBe(200);
  });

  it("手動加点(個人): d2 = 80 + 50 = 130", () => {
    const d2 = res.individuals.find((d) => d.driverId === "d2")!;
    expect(d2.autoPoints).toBe(80);
    expect(d2.manualPoints).toBe(50);
    expect(d2.total).toBe(130);
  });

  it("未所属ドライバーは集計対象外（d4 は出ない）", () => {
    expect(res.individuals.some((d) => d.driverId === "d4")).toBe(false);
  });

  it("チーム合計: 赤 = 110 + 130 = 240", () => {
    const red = res.teams.find((t) => t.teamId === "team-red")!;
    expect(red.memberPoints).toBe(240);
    expect(red.teamManualPoints).toBe(0);
    expect(red.total).toBe(240);
  });

  it("チーム合計: 青 = 200 + チーム手動30 = 230", () => {
    const blue = res.teams.find((t) => t.teamId === "team-blue")!;
    expect(blue.memberPoints).toBe(200);
    expect(blue.teamManualPoints).toBe(30);
    expect(blue.total).toBe(230);
  });

  it("チーム順位は total 降順（赤240 > 青230）", () => {
    expect(res.teams.map((t) => t.teamId)).toEqual(["team-red", "team-blue"]);
  });

  it("個人MVP順位は total 降順（d3:200 > d2:130 > d1:110）", () => {
    expect(res.individuals.map((d) => d.driverId)).toEqual(["d3", "d2", "d1"]);
  });

  it("ルール別内訳: d1 完了120pt / 持戻-10pt", () => {
    const d1 = res.individuals.find((d) => d.driverId === "d1")!;
    const completed = d1.breakdown.find((b) => b.ruleId === "r-completed")!;
    const returned = d1.breakdown.find((b) => b.ruleId === "r-returned")!;
    expect(completed).toMatchObject({ quantity: 120, points: 120 });
    expect(returned).toMatchObject({ quantity: 5, points: -10 });
  });

  it("チーム内メンバーは total 降順に並ぶ", () => {
    const red = res.teams.find((t) => t.teamId === "team-red")!;
    expect(red.members.map((m) => m.driverId)).toEqual(["d2", "d1"]); // 130 > 110
  });
});

// ────────────────────────────────────────────────────────────
// computeEventScores — エッジケース
// ────────────────────────────────────────────────────────────

describe("computeEventScores — エッジケース", () => {
  it("ルールが空でもメンバー全員が 0pt で集計される", () => {
    const res = computeEventScores({ ...baseInput, scoringRule: emptyScoringRuleSet() });
    expect(res.individuals).toHaveLength(3);
    expect(res.individuals.every((d) => d.autoPoints === 0)).toBe(true);
    // 手動加点は空ルールでも反映される
    expect(res.individuals.find((d) => d.driverId === "d2")!.total).toBe(50);
  });

  it("報告ゼロでもメンバー全員が 0pt の breakdown 付きで返る", () => {
    const res = computeEventScores({ ...baseInput, reports: [], manualEntries: [] });
    const d1 = res.individuals.find((d) => d.driverId === "d1")!;
    expect(d1.total).toBe(0);
    expect(d1.breakdown).toHaveLength(2);
    expect(d1.breakdown.every((b) => b.quantity === 0 && b.points === 0)).toBe(true);
  });

  it("ルール対象外フィールドは加点されない", () => {
    const res = computeEventScores({
      ...baseInput,
      manualEntries: [],
      reports: [report("d1", true, [{ unitId: U_TAKKYU, fieldKey: "unknown-field", valueNum: 100 }])],
    });
    expect(res.individuals.find((d) => d.driverId === "d1")!.autoPoints).toBe(0);
  });

  it("同一ドライバーの複数報告は数量が合算される", () => {
    const res = computeEventScores({
      ...baseInput,
      manualEntries: [],
      reports: [
        report("d1", true, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 30 }]),
        report("d1", true, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 70 }]),
      ],
    });
    expect(res.individuals.find((d) => d.driverId === "d1")!.autoPoints).toBe(100);
  });

  it("手動エントリの points が不正値（NaN）なら 0 として扱う", () => {
    const res = computeEventScores({
      ...baseInput,
      reports: [],
      manualEntries: [
        { driverId: "d1", teamId: null, points: Number("abc"), reason: null, entryDate: null },
      ],
    });
    expect(res.individuals.find((d) => d.driverId === "d1")!.total).toBe(0);
  });

  it("手動減点（マイナス）で total が負になり得る", () => {
    const res = computeEventScores({
      ...baseInput,
      reports: [],
      manualEntries: [{ driverId: "d1", teamId: null, points: -40, reason: "ペナルティ", entryDate: null }],
    });
    const d1 = res.individuals.find((d) => d.driverId === "d1")!;
    expect(d1.manualPoints).toBe(-40);
    expect(d1.total).toBe(-40);
  });
});

// ────────────────────────────────────────────────────────────
// computeEventScores — 同点タイブレークの決定性
// ────────────────────────────────────────────────────────────

describe("computeEventScores — 同点タイブレーク", () => {
  it("個人同点は driverId 昇順で決定的に並ぶ", () => {
    const res = computeEventScores({
      ...baseInput,
      reports: [],
      manualEntries: [],
      // members の登録順を逆にしても結果順は不変であること
      members: [
        { driverId: "d3", teamId: "team-blue" },
        { driverId: "d2", teamId: "team-red" },
        { driverId: "d1", teamId: "team-red" },
      ],
    });
    expect(res.individuals.map((d) => d.driverId)).toEqual(["d1", "d2", "d3"]);
  });

  it("チーム同点は sortOrder 昇順で決定的に並ぶ", () => {
    const res = computeEventScores({ ...baseInput, reports: [], manualEntries: [] });
    // 全チーム 0pt → sortOrder 順（赤=1, 青=2）
    expect(res.teams.map((t) => t.teamId)).toEqual(["team-red", "team-blue"]);
  });

  it("チーム内メンバー同点は driverId 昇順", () => {
    const res = computeEventScores({ ...baseInput, reports: [], manualEntries: [] });
    const red = res.teams.find((t) => t.teamId === "team-red")!;
    expect(red.members.map((m) => m.driverId)).toEqual(["d1", "d2"]);
  });
});

// ────────────────────────────────────────────────────────────
// 探索的テスト: 予期せぬ「小数」入力でバグが出ないか
//   小数ポイントは仕様上許可されている（pointsPer・手動とも 負/小数可）。
//   浮動小数の累積誤差が total や同点判定を壊さないか確認する。
// ────────────────────────────────────────────────────────────

describe("computeEventScores — 小数ポイントの累積誤差", () => {
  it("0.1 + 0.2 の手動加点が 0.3 として扱われる（浮動小数の誤差が出ない）", () => {
    const res = computeEventScores({
      ...baseInput,
      reports: [],
      manualEntries: [
        { driverId: "d1", teamId: null, points: 0.1, reason: null, entryDate: null },
        { driverId: "d1", teamId: null, points: 0.2, reason: null, entryDate: null },
      ],
    });
    expect(res.individuals.find((d) => d.driverId === "d1")!.total).toBe(0.3);
  });

  it("小数 pointsPer × 数量の自動採点も誤差なく計算される", () => {
    const res = computeEventScores({
      ...baseInput,
      manualEntries: [],
      scoringRule: {
        version: 1,
        rules: [{ id: "r", label: "歩合", fields: [{ unitId: U_TAKKYU, fieldKey: "completed" }], pointsPer: 0.1 }],
      },
      reports: [report("d1", true, [{ unitId: U_TAKKYU, fieldKey: "completed", valueNum: 3 }])],
    });
    // 0.1 × 3 = 0.30000000000000004 になりがち → 0.3 であってほしい
    expect(res.individuals.find((d) => d.driverId === "d1")!.total).toBe(0.3);
  });

  it("本来同点の2人が浮動小数の誤差で別順位にならない", () => {
    // d1 に 0.1+0.2、d2 に 0.3 → 両者 0.3 で同点のはず
    const res = computeEventScores({
      ...baseInput,
      reports: [],
      manualEntries: [
        { driverId: "d1", teamId: null, points: 0.1, reason: null, entryDate: null },
        { driverId: "d1", teamId: null, points: 0.2, reason: null, entryDate: null },
        { driverId: "d2", teamId: null, points: 0.3, reason: null, entryDate: null },
      ],
    });
    const d1 = res.individuals.find((d) => d.driverId === "d1")!;
    const d2 = res.individuals.find((d) => d.driverId === "d2")!;
    expect(d1.total).toBe(d2.total); // 厳密一致（=== 同点）であること
  });
});

// ────────────────────────────────────────────────────────────
// normalizeScoringRuleSet — jsonb 正規化
// ────────────────────────────────────────────────────────────

describe("normalizeScoringRuleSet", () => {
  it("null / undefined / 非オブジェクトは空ルールセットになる", () => {
    expect(normalizeScoringRuleSet(null)).toEqual(emptyScoringRuleSet());
    expect(normalizeScoringRuleSet(undefined)).toEqual(emptyScoringRuleSet());
    expect(normalizeScoringRuleSet("garbage")).toEqual(emptyScoringRuleSet());
    expect(normalizeScoringRuleSet(123)).toEqual(emptyScoringRuleSet());
  });

  it("rules が配列でない場合は空ルールセットになる", () => {
    expect(normalizeScoringRuleSet({ rules: "not-array" })).toEqual(emptyScoringRuleSet());
    expect(normalizeScoringRuleSet({})).toEqual(emptyScoringRuleSet());
  });

  it("正常なルールはそのまま保持される", () => {
    const normalized = normalizeScoringRuleSet(scoringRule);
    expect(normalized.rules).toHaveLength(2);
    expect(normalized.rules[0]).toEqual(scoringRule.rules[0]);
  });

  it("不正な fields 要素は除外される", () => {
    const normalized = normalizeScoringRuleSet({
      rules: [
        {
          id: "r1",
          label: "test",
          fields: [
            { unitId: "u1", fieldKey: "f1" },
            null,
            { unitId: 123, fieldKey: "f2" }, // unitId が文字列でない
            "garbage",
          ],
          pointsPer: 1,
        },
      ],
    });
    expect(normalized.rules[0].fields).toEqual([{ unitId: "u1", fieldKey: "f1" }]);
  });

  it("id 欠落は rule_N で採番、label 欠落は空文字、pointsPer 不正は 0", () => {
    const normalized = normalizeScoringRuleSet({
      rules: [{ fields: [], pointsPer: "abc" }],
    });
    expect(normalized.rules[0]).toEqual({ id: "rule_1", label: "", fields: [], pointsPer: 0 });
  });

  it("rules 内の null / 非オブジェクト要素はスキップされる", () => {
    const normalized = normalizeScoringRuleSet({
      rules: [null, "x", { id: "r1", label: "ok", fields: [], pointsPer: 2 }],
    });
    expect(normalized.rules).toHaveLength(1);
    expect(normalized.rules[0].id).toBe("r1");
  });
});
