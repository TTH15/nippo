import { describe, it, expect } from "vitest";
import { diffShiftRequests, summarizeHistory, type ExistingReq, type ShiftLog } from "./diff";

const ex = (id: string, date: string, slot: string | null): ExistingReq => ({ id, request_date: date, slot_id: slot });

// ────────────────────────────────────────────────────────────
// diffShiftRequests
// ────────────────────────────────────────────────────────────

describe("diffShiftRequests", () => {
  it("既存が空なら desired 全件が追加", () => {
    const d = diffShiftRequests([], [{ request_date: "2026-06-01", slot_id: null }]);
    expect(d.toAdd).toHaveLength(1);
    expect(d.toRemove).toHaveLength(0);
  });

  it("desired が空なら既存全件が削除", () => {
    const d = diffShiftRequests([ex("a", "2026-06-01", null)], []);
    expect(d.toAdd).toHaveLength(0);
    expect(d.toRemove.map((r) => r.id)).toEqual(["a"]);
  });

  it("同一(date,slot)は変更なし＝触らない", () => {
    const d = diffShiftRequests(
      [ex("a", "2026-06-01", null)],
      [{ request_date: "2026-06-01", slot_id: null }],
    );
    expect(d.toAdd).toHaveLength(0);
    expect(d.toRemove).toHaveLength(0);
  });

  it("追加と削除が混在", () => {
    const d = diffShiftRequests(
      [ex("a", "2026-06-01", null), ex("b", "2026-06-02", null)],
      [{ request_date: "2026-06-02", slot_id: null }, { request_date: "2026-06-03", slot_id: null }],
    );
    expect(d.toAdd.map((r) => r.request_date)).toEqual(["2026-06-03"]);
    expect(d.toRemove.map((r) => r.id)).toEqual(["a"]); // 06-01 が消える、06-02 は据え置き
  });

  it("全休と便は別エントリとして区別される", () => {
    const d = diffShiftRequests(
      [ex("a", "2026-06-01", null)], // 全休
      [{ request_date: "2026-06-01", slot_id: "s1" }], // 便s1へ変更
    );
    expect(d.toAdd).toEqual([{ request_date: "2026-06-01", slot_id: "s1" }]);
    expect(d.toRemove.map((r) => r.id)).toEqual(["a"]);
  });

  it("【探索】desired 内の重複は1件に圧縮され二重追加されない", () => {
    const d = diffShiftRequests([], [
      { request_date: "2026-06-01", slot_id: "s1" },
      { request_date: "2026-06-01", slot_id: "s1" },
    ]);
    expect(d.toAdd).toHaveLength(1);
  });

  it("【探索】同じ便が複数日にあっても日付で正しく区別される", () => {
    const d = diffShiftRequests(
      [ex("a", "2026-06-01", "s1")],
      [{ request_date: "2026-06-01", slot_id: "s1" }, { request_date: "2026-06-02", slot_id: "s1" }],
    );
    expect(d.toAdd).toEqual([{ request_date: "2026-06-02", slot_id: "s1" }]);
    expect(d.toRemove).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// summarizeHistory
// ────────────────────────────────────────────────────────────

const log = (action: "add" | "remove", at: string, name = "田中", type: "driver" | "admin" = "driver"): ShiftLog => ({
  action,
  actor_type: type,
  actor_name: name,
  created_at: at,
});

describe("summarizeHistory", () => {
  it("空ログは全て null・changed=false", () => {
    const s = summarizeHistory([]);
    expect(s).toEqual({ firstSubmittedAt: null, lastChangedAt: null, lastActorName: null, lastActorType: null, changed: false });
  });

  it("1件の add は初回=最終、changed=false", () => {
    const s = summarizeHistory([log("add", "2026-05-01T00:00:00Z")]);
    expect(s.firstSubmittedAt).toBe("2026-05-01T00:00:00Z");
    expect(s.lastChangedAt).toBe("2026-05-01T00:00:00Z");
    expect(s.changed).toBe(false);
  });

  it("初回提出は最古の add（入力順がバラバラでも）", () => {
    const s = summarizeHistory([
      log("remove", "2026-05-03T00:00:00Z"),
      log("add", "2026-05-01T00:00:00Z"),
      log("add", "2026-05-05T00:00:00Z"),
    ]);
    expect(s.firstSubmittedAt).toBe("2026-05-01T00:00:00Z");
  });

  it("最終変更は最新イベントの日時・操作者", () => {
    const s = summarizeHistory([
      log("add", "2026-05-01T00:00:00Z", "田中", "driver"),
      log("remove", "2026-05-10T09:00:00Z", "運営者", "admin"),
    ]);
    expect(s.lastChangedAt).toBe("2026-05-10T09:00:00Z");
    expect(s.lastActorName).toBe("運営者");
    expect(s.lastActorType).toBe("admin");
    expect(s.changed).toBe(true);
  });

  it("【探索】add が無く remove のみでも初回は null（落ちない）", () => {
    const s = summarizeHistory([log("remove", "2026-05-10T00:00:00Z")]);
    expect(s.firstSubmittedAt).toBe(null);
    expect(s.lastChangedAt).toBe("2026-05-10T00:00:00Z");
  });
});
