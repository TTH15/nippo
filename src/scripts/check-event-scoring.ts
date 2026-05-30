// ============================================================
// チーム戦（イベント）採点ロジックの検証スクリプト（依存追加なし・tsx で実行）
//   npx tsx src/scripts/check-event-scoring.ts
// 合成データで、報告項目の加点/減点・キャリア横断フィールド・承認フィルタ・
// 手動加点(個人/チーム)・メンバー限定集計・順位 を検証する。
// ============================================================

import assert from "node:assert";
import { computeEventScores } from "../server/events/score";
import type {
  ScoringRuleSet,
  EventTeam,
  EventMember,
  ManualPointEntry,
  ScoringReport,
} from "../server/events/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// --- 合成マスタ -------------------------------------------------
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
  { driverId: "d2", teamId: null, points: 50, reason: "MVP", entryDate: null }, // 個人加点
  { driverId: null, teamId: "team-blue", points: 30, reason: "ボーナス", entryDate: null }, // チーム加点
  { driverId: "d4", teamId: null, points: 999, reason: "未所属は無視", entryDate: null }, // 無視されるべき
];

const res = computeEventScores({ scoringRule, teams, members, reports, manualEntries: manual });

check("自動採点: d1 = 110", () => {
  const d1 = res.individuals.find((d) => d.driverId === "d1")!;
  assert.strictEqual(d1.autoPoints, 110);
  assert.strictEqual(d1.manualPoints, 0);
  assert.strictEqual(d1.total, 110);
});

check("承認なし・却下は除外（d3 自動=200のみ）", () => {
  const d3 = res.individuals.find((d) => d.driverId === "d3")!;
  assert.strictEqual(d3.autoPoints, 200);
});

check("手動加点(個人): d2 = 80 + 50 = 130", () => {
  const d2 = res.individuals.find((d) => d.driverId === "d2")!;
  assert.strictEqual(d2.autoPoints, 80);
  assert.strictEqual(d2.manualPoints, 50);
  assert.strictEqual(d2.total, 130);
});

check("未所属ドライバーは集計対象外（d4 は出ない）", () => {
  assert.ok(!res.individuals.some((d) => d.driverId === "d4"));
});

check("チーム合計: 赤 = 110 + 130 = 240", () => {
  const red = res.teams.find((t) => t.teamId === "team-red")!;
  assert.strictEqual(red.memberPoints, 240);
  assert.strictEqual(red.teamManualPoints, 0);
  assert.strictEqual(red.total, 240);
});

check("チーム合計: 青 = 200 + チーム手動30 = 230", () => {
  const blue = res.teams.find((t) => t.teamId === "team-blue")!;
  assert.strictEqual(blue.memberPoints, 200);
  assert.strictEqual(blue.teamManualPoints, 30);
  assert.strictEqual(blue.total, 230);
});

check("チーム順位は total 降順（赤240 > 青230）", () => {
  assert.strictEqual(res.teams[0].teamId, "team-red");
  assert.strictEqual(res.teams[1].teamId, "team-blue");
});

check("個人MVP順位は total 降順（d3:200 > d2:130 > d1:110）", () => {
  assert.deepStrictEqual(
    res.individuals.map((d) => d.driverId),
    ["d3", "d2", "d1"],
  );
});

check("ルール別内訳: d1 完了120pt / 持戻-10pt", () => {
  const d1 = res.individuals.find((d) => d.driverId === "d1")!;
  const completed = d1.breakdown.find((b) => b.ruleId === "r-completed")!;
  const returned = d1.breakdown.find((b) => b.ruleId === "r-returned")!;
  assert.strictEqual(completed.quantity, 120);
  assert.strictEqual(completed.points, 120);
  assert.strictEqual(returned.quantity, 5);
  assert.strictEqual(returned.points, -10);
});

console.log(`\n✅ event scoring checks passed: ${passed}\n`);
