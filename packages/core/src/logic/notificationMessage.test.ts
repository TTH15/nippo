import { describe, it, expect } from "vitest";
import {
  buildChangeDedupeKey,
  buildChangeMessage,
  buildDayMessage,
  buildRestDayMessage,
  buildDedupeKey,
  diffDay,
  formatPlateOneLine,
  toDisplayTime,
  type AssignmentEntry,
  type DaySnapshot,
} from "./notificationMessage";

// 通知はドライバーの出勤判断に直結するため、
// 「値が無い項目が空欄のまま送られる」「時刻が秒付きで出る」等が起きないことを固定する。

const entry = (over: Partial<AssignmentEntry> = {}): AssignmentEntry => ({
  courseName: "Aコース",
  meetingTime: "08:00",
  meetingPlace: "本社倉庫",
  plate: "京都 100 あ 00-01",
  ...over,
});
const day = (...entries: AssignmentEntry[]): DaySnapshot => ({ entries });
const REST: DaySnapshot = { entries: [] };
const ALL = { includeMeeting: true, includeVehicle: true };

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

describe("buildDayMessage", () => {
  const base = { dateLabel: "7月21日(月)", ...ALL };

  it("全項目そろっているとき", () => {
    const { title, body } = buildDayMessage({ ...base, snapshot: day(entry()) });
    expect(title).toBe("7月21日(月)の予定");
    expect(body).toBe("コース: Aコース\n集合時刻: 08:00\n集合場所: 本社倉庫\n車両: 京都 100 あ 00-01");
  });

  it("値が無い行は落とす（空欄で送らない）", () => {
    const { body } = buildDayMessage({
      ...base,
      snapshot: day(entry({ meetingPlace: null, plate: null })),
    });
    expect(body).toBe("コース: Aコース\n集合時刻: 08:00");
    expect(body).not.toContain("集合場所");
    expect(body).not.toContain("車両");
  });

  it("org 設定で項目を抑制できる", () => {
    const { body } = buildDayMessage({
      ...base,
      includeMeeting: false,
      includeVehicle: false,
      snapshot: day(entry()),
    });
    expect(body).toBe("コース: Aコース");
  });

  it("コース名だけは必ず残る", () => {
    const { body } = buildDayMessage({
      ...base,
      snapshot: day(entry({ meetingPlace: null, meetingTime: null, plate: null })),
    });
    expect(body).toBe("コース: Aコース");
  });

  it("同じ日に複数便あれば空行で区切って両方載せる", () => {
    const { body } = buildDayMessage({
      ...base,
      includeVehicle: false,
      snapshot: day(
        entry({ meetingPlace: null }),
        entry({ courseName: "Bコース", meetingTime: "14:00", meetingPlace: null }),
      ),
    });
    expect(body).toBe("コース: Aコース\n集合時刻: 08:00\n\nコース: Bコース\n集合時刻: 14:00");
  });
});

describe("buildRestDayMessage", () => {
  it("休みの案内を返す", () => {
    expect(buildRestDayMessage("7月21日(月)")).toEqual({
      title: "7月21日(月)の予定",
      body: "明日のシフトは入っていません。",
    });
  });
});

describe("diffDay", () => {
  it("同じ内容なら差分なし（触り直して元に戻したケース）", () => {
    expect(diffDay(day(entry()), day(entry()), ALL)).toBeNull();
  });

  it("休みのまま変わらなければ差分なし", () => {
    expect(diffDay(REST, REST, ALL)).toBeNull();
  });

  it("コースが変わったら changed", () => {
    expect(diffDay(day(entry()), day(entry({ courseName: "Bコース" })), ALL)).toEqual({
      kind: "changed",
      fields: ["コース"],
    });
  });

  it("複数項目が変わったら全部挙げる", () => {
    const diff = diffDay(day(entry()), day(entry({ courseName: "Bコース", meetingTime: "07:30" })), ALL);
    expect(diff?.fields).toEqual(["コース", "集合時刻"]);
  });

  it("休み → 割当は added", () => {
    expect(diffDay(REST, day(entry()), ALL)).toEqual({ kind: "added", fields: [] });
  });

  it("割当 → 休みは canceled", () => {
    expect(diffDay(day(entry()), REST, ALL)).toEqual({ kind: "canceled", fields: [] });
  });

  it("便が増えたら changed（2便目が黙って増えない）", () => {
    const diff = diffDay(day(entry()), day(entry(), entry({ courseName: "Bコース" })), ALL);
    expect(diff).toEqual({ kind: "changed", fields: ["割り当て"] });
  });

  it("通知に載せていない項目の変化は差分に数えない（伝えていないものは伝え直せない）", () => {
    const changedHidden = day(entry({ plate: "京都 100 あ 99-99", meetingTime: "07:30" }));
    expect(
      diffDay(day(entry()), changedHidden, { includeMeeting: false, includeVehicle: false }),
    ).toBeNull();
    expect(diffDay(day(entry()), changedHidden, ALL)).not.toBeNull();
  });
});

describe("buildChangeMessage", () => {
  const opts = { dateLabel: "7月21日(月)", ...ALL };

  it("変わった行にだけ変更前を添え、他の行はそのまま載せる", () => {
    const { title, body } = buildChangeMessage({
      ...opts,
      diff: { kind: "changed", fields: ["コース"] },
      before: day(entry()),
      after: day(entry({ courseName: "Bコース" })),
    });
    expect(title).toBe("【変更】7月21日(月)の予定");
    expect(body).toBe(
      "コース: Bコース（変更前: Aコース）\n集合時刻: 08:00\n集合場所: 本社倉庫\n車両: 京都 100 あ 00-01",
    );
  });

  it("取消は変更前のコースだけ伝える", () => {
    const { title, body } = buildChangeMessage({
      ...opts,
      diff: { kind: "canceled", fields: [] },
      before: day(entry()),
      after: REST,
    });
    expect(title).toBe("【取消】7月21日(月)の予定");
    expect(body).toBe("この日の割り当ては取り消されました。\n変更前のコース: Aコース");
  });

  it("追加は通常のアサイン通知と同じ体裁（変更前を書かない）", () => {
    const { title, body } = buildChangeMessage({
      ...opts,
      diff: { kind: "added", fields: [] },
      before: REST,
      after: day(entry()),
    });
    expect(title).toBe("【追加】7月21日(月)の予定");
    expect(body).toBe("コース: Aコース\n集合時刻: 08:00\n集合場所: 本社倉庫\n車両: 京都 100 あ 00-01");
    expect(body).not.toContain("変更前");
  });

  it("抑制中の項目は変更通知にも出さない", () => {
    const { body } = buildChangeMessage({
      ...opts,
      includeMeeting: false,
      includeVehicle: false,
      diff: { kind: "changed", fields: ["コース"] },
      before: day(entry()),
      after: day(entry({ courseName: "Bコース" })),
    });
    expect(body).toBe("コース: Bコース（変更前: Aコース）");
  });

  it("元が空だった項目は「変更前: なし」と書かない", () => {
    const { body } = buildChangeMessage({
      ...opts,
      diff: { kind: "changed", fields: ["車両"] },
      before: day(entry({ plate: null })),
      after: day(entry()),
    });
    expect(body).toContain("車両: 京都 100 あ 00-01");
    expect(body).not.toContain("変更前: なし");
  });

  it("便数が変わったときは変更前を突き合わせず現状だけ書く", () => {
    const { body } = buildChangeMessage({
      ...opts,
      includeMeeting: false,
      includeVehicle: false,
      diff: { kind: "changed", fields: ["割り当て"] },
      before: day(entry()),
      after: day(entry(), entry({ courseName: "Bコース" })),
    });
    expect(body).toBe("コース: Aコース\n\nコース: Bコース");
    expect(body).not.toContain("変更前");
  });
});

describe("buildChangeDedupeKey", () => {
  it("同じ変更の二重送信は同じキーになる", () => {
    const params = { orgId: "org1", date: "2026-07-21", driverId: "d1", seq: 0 };
    expect(buildChangeDedupeKey(params)).toBe("org1:2026-07-21:change:d1:0");
  });

  it("送信後に再び変わったら別キー（2度目も届く）", () => {
    const params = { orgId: "org1", date: "2026-07-21", driverId: "d1", seq: 0 };
    expect(buildChangeDedupeKey(params)).not.toBe(buildChangeDedupeKey({ ...params, seq: 1 }));
  });

  it("アサイン通知のキーとは衝突しない", () => {
    expect(
      buildChangeDedupeKey({ orgId: "org1", date: "2026-07-21", driverId: "d1", seq: 0 }),
    ).not.toBe(
      buildDedupeKey({ orgId: "org1", date: "2026-07-21", kind: "assignment", driverId: "d1" }),
    );
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

  it("種別が違えば別キー（アサインと休み通知は別々に送れる）", () => {
    const common = { orgId: "org1", date: "2026-07-21", driverId: "d1" };
    expect(buildDedupeKey({ ...common, kind: "assignment" })).not.toBe(
      buildDedupeKey({ ...common, kind: "rest_day" }),
    );
  });
});
