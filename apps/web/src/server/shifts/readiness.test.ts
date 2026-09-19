import { describe, expect, it } from "vitest";
import {
  collectUnresolved,
  isOverdue,
  resolveStaffing,
  shiftDate,
  weekdayOf,
  type CourseFrame,
  type ReadinessInput,
  type ShiftAssignment,
  type UnresolvedItem,
} from "./readiness";

// 2026-09-21(月) 〜 2026-09-23(水)
const DATES = ["2026-09-21", "2026-09-22", "2026-09-23"];
const MON = 1;
const TUE = 2;
const WED = 3;

const frame: CourseFrame = { courseId: "c1", courseName: "豊中1", cycleNo: 1, cycleLabel: "1便" };

const workingBaseline = (weekday: number, count = 2) =>
  ({ courseId: "c1", cycleNo: 1, weekday, state: "working" as const, requiredCount: count });

const assign = (date: string, driverId: string, over: Partial<ShiftAssignment> = {}): ShiftAssignment => ({
  date,
  courseId: "c1",
  cycleNo: 1,
  driverId,
  vehicleId: "v1",
  usesExternalVehicle: false,
  ...over,
});

const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  dates: DATES,
  frames: [frame],
  baselines: [workingBaseline(MON), workingBaseline(TUE), workingBaseline(WED)],
  requirements: [],
  assignments: [],
  confirmations: [],
  plans: [],
  ...over,
});

const kinds = (items: UnresolvedItem[], date?: string) =>
  items.filter((i) => date === undefined || i.date === date).map((i) => i.kind);

describe("日付の道具", () => {
  it("曜日と前後の日付", () => {
    expect(weekdayOf("2026-09-21")).toBe(MON);
    expect(shiftDate("2026-09-01", -3)).toBe("2026-08-29");
    expect(shiftDate("2026-09-21", 1)).toBe("2026-09-22");
  });
});

describe("空白の区別", () => {
  it("日付の指定 > 曜日の基準 > 未入力 の順で決まる", () => {
    const requirements = new Map([["2026-09-21|c1|1", { date: "2026-09-21", courseId: "c1", cycleNo: 1, state: "closed" as const, requiredCount: null }]]);
    const baselines = new Map([["c1|1|" + MON, workingBaseline(MON)]]);
    expect(resolveStaffing("2026-09-21", "c1", 1, requirements, baselines)).toMatchObject({ state: "closed", from: "date" });
    expect(resolveStaffing("2026-09-28", "c1", 1, requirements, baselines)).toMatchObject({ state: "working", requiredCount: 2, from: "baseline" });
    expect(resolveStaffing("2026-09-22", "c1", 1, requirements, new Map())).toMatchObject({ state: "undecided", from: "none" });
  });

  it("基準が無い枠は枠ごとに1件だけ出し、日付ごとには出さない", () => {
    const items = collectUnresolved(input({ baselines: [] }));
    expect(kinds(items)).toEqual(["baseline_missing"]);
    expect(items[0].date).toBeNull();
  });

  it("休みの日は不足にしないが、配置があれば出す", () => {
    const closed = { date: "2026-09-22", courseId: "c1", cycleNo: 1, state: "closed" as const, requiredCount: null };
    expect(kinds(collectUnresolved(input({ requirements: [closed] })), "2026-09-22")).toEqual([]);
    const withAssignment = collectUnresolved(input({ requirements: [closed], assignments: [assign("2026-09-22", "d1")] }));
    expect(kinds(withAssignment, "2026-09-22")).toEqual(["assigned_on_closed"]);
  });

  it("人数未確定は正常扱いしない", () => {
    const undecided = { date: "2026-09-22", courseId: "c1", cycleNo: 1, state: "undecided" as const, requiredCount: null };
    expect(kinds(collectUnresolved(input({ requirements: [undecided] })), "2026-09-22")).toEqual(["undecided"]);
  });
});

describe("配置の不足", () => {
  it("配置が1件も無い日でも不足として出る（全員抜けた日を拾う）", () => {
    const items = collectUnresolved(input());
    expect(kinds(items, "2026-09-21")).toEqual(["shortage"]);
    expect(items[0].detail).toBe("2人必要・0人配置");
  });

  it("意図的に1件抜くと、その日だけ不足になる", () => {
    const assignments = DATES.flatMap((date) => [assign(date, "d1"), assign(date, "d2")])
      .filter((a) => !(a.date === "2026-09-22" && a.driverId === "d2"));
    const items = collectUnresolved(input({ assignments }));
    expect(kinds(items, "2026-09-21")).toEqual([]);
    expect(kinds(items, "2026-09-22")).toEqual(["shortage"]);
  });

  it("車両が未割当の配置は別項目にする。外部車両は不足にしない", () => {
    const assignments = [
      assign("2026-09-21", "d1", { vehicleId: null }),
      assign("2026-09-21", "d2", { vehicleId: null, usesExternalVehicle: true }),
    ];
    const items = collectUnresolved(input({ assignments }));
    expect(kinds(items, "2026-09-21")).toEqual(["no_vehicle"]);
    expect(items.find((i) => i.kind === "no_vehicle")?.driverId).toBe("d1");
  });

  it("車両の未割当が複数なら枠ごとに1件へまとめる", () => {
    const assignments = ["d1", "d2", "d3"].map((driverId) => assign("2026-09-21", driverId, { vehicleId: null }));
    const items = collectUnresolved(input({ assignments }));
    const noVehicle = items.filter((i) => i.kind === "no_vehicle");
    expect(noVehicle).toHaveLength(1);
    expect(noVehicle[0]).toMatchObject({ detail: "3人の車両が未割当", driverId: null });
  });
});

describe("本人の確認", () => {
  const plans = [{ driverId: "d1", date: "2026-09-21", planVersion: "v1" }];

  it("確認がなければ未確認", () => {
    expect(kinds(collectUnresolved(input({ plans })), "2026-09-21")).toContain("unconfirmed");
  });

  it("確認後に予定が変わると確認が無効に戻る", () => {
    const confirmations = [{ driverId: "d1", date: "2026-09-21", planVersion: "v0", response: "confirmed" as const }];
    const items = collectUnresolved(input({ plans, confirmations }));
    expect(kinds(items, "2026-09-21")).toContain("stale_confirmation");
    expect(kinds(items, "2026-09-21")).not.toContain("unconfirmed");
  });

  it("同じ版の確認は未解決に出さない", () => {
    const confirmations = [{ driverId: "d1", date: "2026-09-21", planVersion: "v1", response: "confirmed" as const }];
    const items = collectUnresolved(input({ plans, confirmations }));
    expect(kinds(items, "2026-09-21")).not.toContain("unconfirmed");
    expect(kinds(items, "2026-09-21")).not.toContain("stale_confirmation");
  });

  it("未確認は日ごとにまとめる（運用開始直後に全員ぶん並べない）", () => {
    const manyPlans = ["d1", "d2", "d3"].map((driverId) => ({ driverId, date: "2026-09-21", planVersion: "v1" }));
    const assignments = ["d1", "d2", "d3"].map((driverId) => assign("2026-09-21", driverId));
    const items = collectUnresolved(input({ plans: manyPlans, assignments }));
    const unconfirmed = items.filter((i) => i.kind === "unconfirmed");
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]).toMatchObject({ detail: "3人未確認", driverId: null });
  });

  it("休みの枠にしか予定が無い人へ未確認を出さない", () => {
    const closed = { date: "2026-09-21", courseId: "c1", cycleNo: 1, state: "closed" as const, requiredCount: null };
    const items = collectUnresolved(input({
      requirements: [closed],
      assignments: [assign("2026-09-21", "d1")],
      plans: [{ driverId: "d1", date: "2026-09-21", planVersion: "v1" }],
    }));
    expect(kinds(items, "2026-09-21")).toEqual(["assigned_on_closed"]);
  });

  it("対応不可は最優先で残る", () => {
    const confirmations = [{ driverId: "d1", date: "2026-09-21", planVersion: "v1", response: "unavailable" as const }];
    const items = collectUnresolved(input({ plans, confirmations, assignments: [assign("2026-09-21", "d1"), assign("2026-09-21", "d2")] }));
    expect(kinds(items, "2026-09-21")).toEqual(["unavailable"]);
  });
});

describe("原本との照合", () => {
  const twoPerDay = DATES.flatMap((date) => [assign(date, "d1"), assign(date, "d2")]);

  it("別人に入れ替わっていると、未配置と余りの両方を出す", () => {
    const assignments = twoPerDay.map((a) => (a.date === "2026-09-21" && a.driverId === "d2" ? assign(a.date, "d9") : a));
    const sourceExtracts = [{ date: "2026-09-21", courseId: "c1", cycleNo: 1, driverIds: ["d1", "d2"] }];
    const items = collectUnresolved(input({ assignments, sourceExtracts }));
    const mismatch = items.find((i) => i.kind === "source_mismatch");
    expect(mismatch?.detail).toBe("原本にあって未配置 1人・原本に無い配置 1人");
  });

  it("便をずらして入れると、両方の便で不一致になる", () => {
    const frames: CourseFrame[] = [frame, { courseId: "c1", courseName: "豊中1", cycleNo: 2, cycleLabel: "2便" }];
    const assignments = [assign("2026-09-21", "d1", { cycleNo: 2 })];
    const sourceExtracts = [
      { date: "2026-09-21", courseId: "c1", cycleNo: 1, driverIds: ["d1"] },
      { date: "2026-09-21", courseId: "c1", cycleNo: 2, driverIds: [] },
    ];
    const items = collectUnresolved(input({ frames, assignments, sourceExtracts, baselines: [workingBaseline(MON, 1)] }));
    expect(items.filter((i) => i.kind === "source_mismatch").map((i) => i.cycleNo)).toEqual([1, 2]);
  });

  it("日付をずらして入れると、元の日と入れた日の両方で不一致になる", () => {
    const assignments = [assign("2026-09-22", "d1")];
    const sourceExtracts = [
      { date: "2026-09-21", courseId: "c1", cycleNo: 1, driverIds: ["d1"] },
      { date: "2026-09-22", courseId: "c1", cycleNo: 1, driverIds: [] },
    ];
    const items = collectUnresolved(input({ assignments, sourceExtracts }));
    expect(items.filter((i) => i.kind === "source_mismatch").map((i) => i.date)).toEqual(["2026-09-21", "2026-09-22"]);
  });

  it("原本どおりなら出さない", () => {
    const sourceExtracts = DATES.map((date) => ({ date, courseId: "c1", cycleNo: 1, driverIds: ["d1", "d2"] }));
    const items = collectUnresolved(input({ assignments: twoPerDay, sourceExtracts }));
    expect(kinds(items)).toEqual([]);
  });

  it("対象期間の外の原本は照合しない", () => {
    const sourceExtracts = [{ date: "2026-10-01", courseId: "c1", cycleNo: 1, driverIds: ["d1"] }];
    const items = collectUnresolved(input({ assignments: twoPerDay, sourceExtracts }));
    expect(kinds(items)).toEqual([]);
  });
});

describe("期限と並び", () => {
  it("種類ごとに解消期限が決まる", () => {
    const items = collectUnresolved(input({ plans: [{ driverId: "d1", date: "2026-09-21", planVersion: "v1" }] }));
    expect(items.find((i) => i.kind === "shortage")?.dueDate).toBe("2026-09-18");
    expect(items.find((i) => i.kind === "unconfirmed")?.dueDate).toBe("2026-09-19");
  });

  it("設定を渡すと期限が変わる", () => {
    const settings = { staffingDueDays: 7, confirmationDueDays: 5, dispatchDueDays: 0, horizonDays: 14 };
    const items = collectUnresolved(input({
      plans: [{ driverId: "d1", date: "2026-09-21", planVersion: "v1" }],
      assignments: [assign("2026-09-21", "d1", { vehicleId: null }), assign("2026-09-21", "d2", { vehicleId: null })],
      settings,
    }));
    // 人数・原本は7日前、本人確認は5日前、配車は当日まで
    expect(items.find((i) => i.kind === "shortage" && i.date === "2026-09-22")?.dueDate).toBe("2026-09-15");
    expect(items.find((i) => i.kind === "unconfirmed")?.dueDate).toBe("2026-09-16");
    expect(items.find((i) => i.kind === "no_vehicle")?.dueDate).toBe("2026-09-21");
  });

  it("期限を過ぎたかは当日を含めて判定する", () => {
    const item = { kind: "shortage", dueDate: "2026-09-18" } as UnresolvedItem;
    expect(isOverdue(item, "2026-09-18")).toBe(false);
    expect(isOverdue(item, "2026-09-19")).toBe(true);
  });

  it("日付が早い順・重い順に並ぶ", () => {
    const items = collectUnresolved(input({
      assignments: [assign("2026-09-21", "d1", { vehicleId: null }), assign("2026-09-21", "d2")],
      requirements: [{ date: "2026-09-21", courseId: "c1", cycleNo: 1, state: "working", requiredCount: 3 }],
    }));
    expect(kinds(items, "2026-09-21")).toEqual(["shortage", "no_vehicle"]);
    expect(items[0].date).toBe("2026-09-21");
  });
});
