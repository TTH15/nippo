import { describe, it, expect } from "vitest";
import {
  badgeForShift,
  cycleLabel,
  nextCycleNo,
  resolveCourseTimes,
  shouldShowCycleBadge,
  shouldShowCycleBadgesForSelection,
  type CourseCycle,
} from "./courseCycle";

// 便は「同じコースの1便・2便を区別する」ためだけの概念。
// 画面に出しすぎると煩いので、出す条件をここで固定する。

const cycle = (over: Partial<CourseCycle> & { cycleNo: number }): CourseCycle => ({
  label: null,
  ...over,
});

describe("cycleLabel", () => {
  it("ラベル未設定なら「N便」", () => {
    expect(cycleLabel({ cycleNo: 1 })).toBe("1便");
    expect(cycleLabel({ cycleNo: 2, label: null })).toBe("2便");
    expect(cycleLabel({ cycleNo: 3, label: "  " })).toBe("3便");
  });

  it("ラベルがあればそれを使う（C1 のような書き方もできる）", () => {
    expect(cycleLabel({ cycleNo: 1, label: "C1" })).toBe("C1");
    expect(cycleLabel({ cycleNo: 1, label: "朝便" })).toBe("朝便");
  });
});

describe("shouldShowCycleBadge", () => {
  it("便が2つ以上あるコースだけ出す", () => {
    expect(shouldShowCycleBadge([{ cycleNo: 1 }, { cycleNo: 2 }])).toBe(true);
  });

  it("便が1つしか無いなら出さない（区別する必要がない）", () => {
    expect(shouldShowCycleBadge([{ cycleNo: 1 }])).toBe(false);
  });

  it("便が無い・未取得なら出さない", () => {
    expect(shouldShowCycleBadge([])).toBe(false);
    expect(shouldShowCycleBadge(null)).toBe(false);
    expect(shouldShowCycleBadge(undefined)).toBe(false);
  });
});

describe("badgeForShift", () => {
  const two = [cycle({ cycleNo: 1 }), cycle({ cycleNo: 2, label: "C2" })];

  it("便が複数あるコースの割当にはバッジを出す", () => {
    expect(badgeForShift(1, two)).toBe("1便");
    expect(badgeForShift(2, two)).toBe("C2");
  });

  it("便が1つのコースには出さない", () => {
    expect(badgeForShift(1, [cycle({ cycleNo: 1 })])).toBeNull();
  });

  it("便未設定(0)の割当には出さない（移行期の状態）", () => {
    expect(badgeForShift(0, two)).toBeNull();
    expect(badgeForShift(null, two)).toBeNull();
    expect(badgeForShift(undefined, two)).toBeNull();
  });

  it("マスタから消えた便番号でも番号だけは出す（黙って隠さない）", () => {
    expect(badgeForShift(3, two)).toBe("3便");
  });
});

describe("shouldShowCycleBadgesForSelection", () => {
  it("全サイクルが選ばれている場合はバッジを出さない", () => {
    expect(shouldShowCycleBadgesForSelection([1, 2], [1, 2])).toBe(false);
    expect(shouldShowCycleBadgesForSelection([2, 1, 1], [1, 2])).toBe(false);
  });

  it("一部のサイクルだけなら識別バッジを出す", () => {
    expect(shouldShowCycleBadgesForSelection([1], [1, 2])).toBe(true);
    expect(shouldShowCycleBadgesForSelection([2], [1, 2])).toBe(true);
  });

  it("単一サイクルをすべて選んだ場合とサイクル未使用では出さない", () => {
    expect(shouldShowCycleBadgesForSelection([1], [1])).toBe(false);
    expect(shouldShowCycleBadgesForSelection([0], [1, 2])).toBe(false);
  });

  it("マスター外のサイクルは隠さない", () => {
    expect(shouldShowCycleBadgesForSelection([1, 3], [1, 2])).toBe(true);
    expect(shouldShowCycleBadgesForSelection([3], [])).toBe(true);
  });
});

describe("resolveCourseTimes", () => {
  const course = { meetingTime: "08:00", arrivalTime: "09:00", endTime: "17:00", meetingPlace: "本社" };
  const cycleTimes = { meetingTime: "12:30", arrivalTime: "13:00", endTime: "21:00", meetingPlace: null };
  const shift = { meetingTime: "07:30", arrivalTime: null, endTime: null, meetingPlace: null };

  it("サイクル未使用なら shifts ?? courses（従来どおり・便は無視する）", () => {
    const t = resolveCourseTimes({ shift, cycle: cycleTimes, course, usesCycles: false });
    expect(t.meetingTime).toBe("07:30");
    expect(t.arrivalTime).toBe("09:00");
    expect(t.endTime).toBe("17:00");
  });

  it("サイクル使用中は便がコースより優先される", () => {
    const t = resolveCourseTimes({ shift: null, cycle: cycleTimes, course, usesCycles: true });
    expect(t.meetingTime).toBe("12:30");
    expect(t.endTime).toBe("21:00");
    // 便に無い項目はコース既定へ落ちる
    expect(t.meetingPlace).toBe("本社");
  });

  it("シフトの個別上書きは便より強い", () => {
    const t = resolveCourseTimes({ shift, cycle: cycleTimes, course, usesCycles: true });
    expect(t.meetingTime).toBe("07:30");
    expect(t.arrivalTime).toBe("13:00");
  });

  it("どこにも無ければ null（行ごと落とせるように）", () => {
    const t = resolveCourseTimes({ usesCycles: true });
    expect(t).toEqual({
      meetingPlace: null,
      meetingTime: null,
      arrivalTime: null,
      endTime: null,
    });
  });

  it("空文字は未設定として扱う", () => {
    const t = resolveCourseTimes({
      shift: { meetingTime: "" },
      course: { meetingTime: "08:00" },
      usesCycles: false,
    });
    expect(t.meetingTime).toBe("08:00");
  });
});

describe("nextCycleNo", () => {
  it("最初は1", () => {
    expect(nextCycleNo([])).toBe(1);
  });

  it("最大+1（欠番は埋めない＝番号を使い回さない）", () => {
    expect(nextCycleNo([{ cycleNo: 1 }, { cycleNo: 2 }])).toBe(3);
    expect(nextCycleNo([{ cycleNo: 1 }, { cycleNo: 3 }])).toBe(4);
  });
});
