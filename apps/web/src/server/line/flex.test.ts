import { describe, it, expect } from "vitest";
import { buildAssignmentFlex } from "./flex";
import type { AssignmentEntry, DaySnapshot } from "@repo/core/logic/notificationMessage";

// Flex が壊れていると LINE API が 400 を返し、その人への配信ごと失敗する
// （インボックスには残るが LINE には届かない）。構造の要点をここで固定する。

const entry = (over: Partial<AssignmentEntry> = {}): AssignmentEntry => ({
  courseName: "Aコース",
  meetingTime: "08:00",
  meetingPlace: "本社倉庫",
  plate: "京都 100 あ 00-01",
  ...over,
});
const day = (...entries: AssignmentEntry[]): DaySnapshot => ({ entries });

const base = {
  title: "7月21日(月)の予定",
  body: "コース: Aコース",
  dateLabel: "7月21日(月)",
  date: "2026-07-21",
  includeMeeting: true,
  includeVehicle: true,
  appBaseUrl: "https://example.com",
} as const;

type Node = Record<string, unknown>;

/** カード内の全テキストを拾う。 */
function texts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  const own = n.type === "text" && typeof n.text === "string" ? [n.text] : [];
  return [...own, ...Object.values(n).flatMap(texts)];
}

/** ボタンのラベルと遷移先。 */
function buttons(node: unknown): { label: string; uri: string }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  const action = n.action as Node | undefined;
  const own =
    n.type === "button" && action?.type === "uri"
      ? [{ label: String(action.label), uri: String(action.uri) }]
      : [];
  return [...own, ...Object.values(n).flatMap(buttons)];
}

/** 取り消し線が付いたテキスト（＝変更前の値）。 */
function struckThrough(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(struckThrough);
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  const own = n.decoration === "line-through" && typeof n.text === "string" ? [n.text] : [];
  return [...own, ...Object.values(n).flatMap(struckThrough)];
}

describe("buildAssignmentFlex", () => {
  it("altText はテキスト版と同じ（通知バナーの見え方を変えない）", () => {
    const message = buildAssignmentFlex({ ...base, kind: "assignment", after: day(entry()) });
    expect(message.type).toBe("flex");
    if (message.type !== "flex") return;
    expect(message.altText).toBe("7月21日(月)の予定\n\nコース: Aコース");
  });

  it("日付と明細を載せる", () => {
    const message = buildAssignmentFlex({ ...base, kind: "assignment", after: day(entry()) });
    const all = texts(message);
    expect(all).toContain("7月21日(月)");
    expect(all).toContain("Aコース");
    expect(all).toContain("08:00");
    expect(all).toContain("本社倉庫");
    expect(all).toContain("京都 100 あ 00-01");
  });

  it("org 設定で抑制した項目はカードにも出さない", () => {
    const all = texts(
      buildAssignmentFlex({
        ...base,
        kind: "assignment",
        after: day(entry()),
        includeMeeting: false,
        includeVehicle: false,
      }),
    );
    expect(all).toContain("Aコース");
    expect(all).not.toContain("08:00");
    expect(all).not.toContain("京都 100 あ 00-01");
  });

  it("変更のときだけ変更前の値を取り消し線で添える", () => {
    const changed = buildAssignmentFlex({
      ...base,
      kind: "changed",
      before: day(entry()),
      after: day(entry({ courseName: "Bコース" })),
    });
    expect(struckThrough(changed)).toEqual(["Aコース"]);

    // 変わっていない項目には付けない
    expect(struckThrough(changed)).not.toContain("08:00");
  });

  it("カレンダー追加とアプリ導線のボタンを付ける", () => {
    const links = buttons(buildAssignmentFlex({ ...base, kind: "assignment", after: day(entry()) }));
    const calendar = links.find((b) => b.label === "カレンダーに追加");
    expect(calendar?.uri).toContain("calendar.google.com");
    expect(calendar?.uri).toContain("20260721T080000");
    expect(links.find((b) => b.label === "アプリでシフトを見る")?.uri).toBe(
      "https://example.com/shifts",
    );
  });

  it("アプリの URL が未設定ならその導線を出さない（壊れたリンクを送らない）", () => {
    const links = buttons(
      buildAssignmentFlex({ ...base, kind: "assignment", after: day(entry()), appBaseUrl: null }),
    );
    expect(links.some((b) => b.label === "アプリでシフトを見る")).toBe(false);
    expect(links.some((b) => b.label === "カレンダーに追加")).toBe(true);
  });

  it("取消にはカレンダー追加を出さない", () => {
    const message = buildAssignmentFlex({
      ...base,
      kind: "canceled",
      before: day(entry()),
      after: day(),
    });
    expect(buttons(message).some((b) => b.label.startsWith("カレンダー"))).toBe(false);
    expect(texts(message)).toContain("この日の割り当ては取り消されました。");
  });

  it("休みの日は割り当てが無いことだけ伝える", () => {
    const all = texts(buildAssignmentFlex({ ...base, kind: "rest_day", after: day() }));
    expect(all).toContain("この日のシフトは入っていません。");
  });

  it("複数便はどれをカレンダーに入れるか分かるようコース名を添える", () => {
    const links = buttons(
      buildAssignmentFlex({
        ...base,
        kind: "assignment",
        after: day(entry(), entry({ courseName: "Bコース", meetingTime: "14:00" })),
      }),
    );
    expect(links.map((b) => b.label)).toEqual([
      "カレンダーに追加（Aコース）",
      "カレンダーに追加（Bコース）",
      "アプリでシフトを見る",
    ]);
  });

  it("便数が変わったときは変更前を突き合わせない（ずれた比較を出さない）", () => {
    const message = buildAssignmentFlex({
      ...base,
      kind: "changed",
      before: day(entry()),
      after: day(entry(), entry({ courseName: "Bコース" })),
    });
    expect(struckThrough(message)).toEqual([]);
  });

  it("終業時刻があればカレンダーの終了時刻に使う", () => {
    const links = buttons(
      buildAssignmentFlex({
        ...base,
        kind: "assignment",
        after: day(entry()),
        endTimes: ["17:30"],
      }),
    );
    expect(links[0].uri).toContain("20260721T080000%2F20260721T173000");
  });
});
