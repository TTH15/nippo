import { describe, it, expect, vi } from "vitest";

// 対象は純粋関数だが、モジュールが読み込み時に supabase クライアントを作るため差し替える。
vi.mock("@/server/db/client", () => ({ supabase: {} }));

import { reduceBaselines, type BaselineRow } from "./pendingChanges";
import type { DaySnapshot } from "@repo/core/logic/notificationMessage";

// 「最後にドライバーへ伝えた内容」の畳み込み。ここが狂うと
// 変わっていないのに変更通知が出たり、変わったのに出なかったりする。
// seq は変更通知の冪等キーに入るため、数え違いは二重送信/送信漏れに直結する。

const DATES = ["2026-07-21", "2026-07-22"];

const snapshot = (courseName: string | null): DaySnapshot =>
  courseName
    ? { entries: [{ courseName, meetingTime: "08:00", meetingPlace: null, plate: null }] }
    : { entries: [] };

const row = (over: Partial<BaselineRow> & { date?: string; course?: string | null }): BaselineRow => ({
  driver_id: "d1",
  kind: "assignment",
  created_at: "2026-07-20T11:00:00Z",
  payload: {
    date: over.date ?? "2026-07-21",
    snapshot: snapshot(over.course === undefined ? "Aコース" : over.course),
  },
  ...over,
});

describe("reduceBaselines", () => {
  it("後の通知が基準を上書きする（最後に伝えた内容が残る）", () => {
    const result = reduceBaselines(
      [
        row({ course: "Aコース" }),
        row({ kind: "change", course: "Bコース", created_at: "2026-07-20T13:00:00Z" }),
      ],
      DATES,
    );
    expect(result.byDriver.get("2026-07-21 d1")?.snapshot).toEqual(snapshot("Bコース"));
  });

  it("変更通知の件数だけを seq に数える", () => {
    const result = reduceBaselines(
      [
        row({ course: "Aコース" }),
        row({ kind: "change", course: "Bコース" }),
        row({ kind: "change", course: "Cコース" }),
      ],
      DATES,
    );
    expect(result.byDriver.get("2026-07-21 d1")?.seq).toBe(2);
  });

  it("まだ変更を送っていなければ seq は 0", () => {
    const result = reduceBaselines([row({})], DATES);
    expect(result.byDriver.get("2026-07-21 d1")?.seq).toBe(0);
  });

  it("休みの通知も基準になる（割り当てが無いと伝えた状態）", () => {
    const result = reduceBaselines([row({ kind: "rest_day", course: null })], DATES);
    expect(result.byDriver.get("2026-07-21 d1")?.snapshot).toEqual({ entries: [] });
  });

  it("定時通知が流れた日を覚える（その日に新しく割り当てられた人を拾うため）", () => {
    const result = reduceBaselines(
      [row({ date: "2026-07-21" }), row({ kind: "change", date: "2026-07-22" })],
      DATES,
    );
    expect(result.notifiedDates.has("2026-07-21")).toBe(true);
    // 変更通知だけでは「その日の定時通知が終わった」とは言えない
    expect(result.notifiedDates.has("2026-07-22")).toBe(false);
  });

  it("snapshot を持たない古い通知は基準にしない（導入前の通知で誤検知しない）", () => {
    const legacy: BaselineRow = {
      driver_id: "d1",
      kind: "assignment",
      created_at: "2026-07-20T11:00:00Z",
      payload: { date: "2026-07-21" },
    };
    const result = reduceBaselines([legacy], DATES);
    expect(result.byDriver.size).toBe(0);
    expect(result.notifiedDates.size).toBe(0);
  });

  it("対象期間外の日付は無視する", () => {
    const result = reduceBaselines([row({ date: "2026-06-01" })], DATES);
    expect(result.byDriver.size).toBe(0);
  });

  it("宛先不明（driver_id なし）の行は無視する", () => {
    const result = reduceBaselines([row({ driver_id: null })], DATES);
    expect(result.byDriver.size).toBe(0);
  });

  it("ドライバーごと・日付ごとに独立して持つ", () => {
    const result = reduceBaselines(
      [
        row({ driver_id: "d1", course: "Aコース" }),
        row({ driver_id: "d2", course: "Bコース" }),
        row({ driver_id: "d1", date: "2026-07-22", course: "Cコース" }),
      ],
      DATES,
    );
    expect(result.byDriver.get("2026-07-21 d1")?.snapshot).toEqual(snapshot("Aコース"));
    expect(result.byDriver.get("2026-07-21 d2")?.snapshot).toEqual(snapshot("Bコース"));
    expect(result.byDriver.get("2026-07-22 d1")?.snapshot).toEqual(snapshot("Cコース"));
  });
});
