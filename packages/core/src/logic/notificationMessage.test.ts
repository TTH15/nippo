import { describe, it, expect } from "vitest";
import {
  buildAssignmentMessage,
  buildRestDayMessage,
  buildDedupeKey,
  formatPlateOneLine,
  toDisplayTime,
} from "./notificationMessage";

// 通知はドライバーの出勤判断に直結するため、
// 「値が無い項目が空欄のまま送られる」「時刻が秒付きで出る」等が起きないことを固定する。

describe("toDisplayTime", () => {
  it("秒を落とす", () => {
    expect(toDisplayTime("08:00:00")).toBe("08:00");
  });

  it("未設定は null", () => {
    expect(toDisplayTime(null)).toBeNull();
    expect(toDisplayTime(undefined)).toBeNull();
    expect(toDisplayTime("")).toBeNull();
  });
});

describe("formatPlateOneLine", () => {
  it("4要素を空白区切りで連結する", () => {
    expect(
      formatPlateOneLine({
        number_prefix: "京都",
        number_class: "100",
        number_hiragana: "あ",
        number_numeric: "00-01",
      }),
    ).toBe("京都 100 あ 00-01");
  });

  it("欠けている要素は詰める", () => {
    expect(formatPlateOneLine({ number_prefix: "京都", number_numeric: "00-01" })).toBe(
      "京都 00-01",
    );
  });

  it("全部空なら null（車両行を落とすため）", () => {
    expect(formatPlateOneLine({ number_prefix: "  ", number_numeric: "" })).toBeNull();
    expect(formatPlateOneLine(null)).toBeNull();
  });
});

describe("buildAssignmentMessage", () => {
  const base = {
    courseName: "Aコース",
    meetingPlace: "本社倉庫",
    meetingTime: "08:00",
    plate: "京都 100 あ 00-01",
    dateLabel: "7/21(月)",
    includeMeeting: true,
    includeVehicle: true,
  };

  it("全項目そろっているとき", () => {
    const { title, body } = buildAssignmentMessage(base);
    expect(title).toBe("7/21(月)の予定");
    expect(body).toBe("コース: Aコース\n集合時刻: 08:00\n集合場所: 本社倉庫\n車両: 京都 100 あ 00-01");
  });

  it("値が無い行は落とす（空欄で送らない）", () => {
    const { body } = buildAssignmentMessage({ ...base, meetingPlace: null, plate: null });
    expect(body).toBe("コース: Aコース\n集合時刻: 08:00");
    expect(body).not.toContain("集合場所");
    expect(body).not.toContain("車両");
  });

  it("org 設定で項目を抑制できる", () => {
    const { body } = buildAssignmentMessage({
      ...base,
      includeMeeting: false,
      includeVehicle: false,
    });
    expect(body).toBe("コース: Aコース");
  });

  it("変更通知は件名に【変更】が付く", () => {
    const { title } = buildAssignmentMessage({ ...base, isChange: true });
    expect(title).toBe("【変更】7/21(月)の予定");
  });

  it("コース名だけは必ず残る", () => {
    const { body } = buildAssignmentMessage({
      ...base,
      meetingPlace: null,
      meetingTime: null,
      plate: null,
    });
    expect(body).toBe("コース: Aコース");
  });
});

describe("buildRestDayMessage", () => {
  it("休みの案内を返す", () => {
    expect(buildRestDayMessage("7/21(月)")).toEqual({
      title: "7/21(月)の予定",
      body: "明日のシフトは入っていません。",
    });
  });
});

describe("buildDedupeKey", () => {
  it("org×日×種別×membership で一意になる", () => {
    const key = buildDedupeKey({
      orgId: "org1",
      date: "2026-07-21",
      kind: "assignment",
      driverId: "d1",
    });
    expect(key).toBe("org1:2026-07-21:assignment:d1");
  });

  it("種別が違えば別キー（アサインと変更通知は別々に送れる）", () => {
    const common = { orgId: "org1", date: "2026-07-21", driverId: "d1" };
    expect(buildDedupeKey({ ...common, kind: "assignment" })).not.toBe(
      buildDedupeKey({ ...common, kind: "assignment_changed" }),
    );
  });
});
