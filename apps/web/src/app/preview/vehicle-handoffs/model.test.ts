import { describe, expect, it } from "vitest";
import { cancelMove, markArrived, messages, notificationAt, previousDay, previewNow, runNotice, sampleUses, saveMove, suggestMoves, validateMove } from "./model";

const draft = () => ({ ...suggestMoves(sampleUses)[0], assigneeId: "driver-4" });

describe("車両の移動・受け渡し案", () => {
  it("拠点の違う次の配車から往路と復路を分け、担当者と実位置は推測で確定しない", () => {
    const moves = suggestMoves(sampleUses);
    expect(moves).toHaveLength(3);
    expect(moves.map(move => [move.fromPlaceId, move.toPlaceId])).toEqual([["toyonaka", "kyoto"], ["kyoto", "toyonaka"], ["toyonaka", "toyonaka"]]);
    expect(moves.every(move => move.state === "needed" && !move.assigneeId && !move.actualPlaceId)).toBe(true);
    expect(suggestMoves(sampleUses.map(use => ({ ...use, placeId: "toyonaka", driverId: "driver-1" })))).toEqual([]);
    expect(suggestMoves(sampleUses.map(use => ({ ...use, placeId: "" })))).toEqual([]);
    expect(validateMove({ ...moves[2], assigneeId: "driver-1" }, previewNow)).toBeNull();
  });
  it("前日通知を次の利用日から計算し、月・年をまたいでも日付が合う", () => {
    expect(notificationAt(draft())).toBe("2026-09-03T18:00");
    expect(previousDay("2026-09-01")).toBe("2026-08-31");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
  });
  it("未設定、移動できない時間、過去や期限後の通知を保存しない", () => {
    expect(validateMove({ ...draft(), assigneeId: "" }, previewNow)).toMatch(/担当者/);
    expect(validateMove({ ...draft(), dueAt: "2026-09-03T18:00" }, previewNow)).toMatch(/前の仕事/);
    expect(validateMove({ ...draft(), dueAt: "2026-09-04T08:00" }, previewNow)).toMatch(/次の仕事/);
    expect(validateMove(draft(), "2026-09-03T19:00")).toMatch(/過ぎています/);
    expect(validateMove({ ...draft(), notifyMode: "specified", notifyDate: "2026-09-04", notifyTime: "06:45" }, previewNow)).toMatch(/期限より前/);
  });
  it("予約を変更すると古い日時で送らず、送信済みなら変更連絡にする", () => {
    const initial = saveMove(draft(), draft(), previewNow);
    const updated = saveMove({ ...initial, notifyTime: "19:00" }, initial, previewNow);
    expect(runNotice(updated, "2026-09-03T18:00").notice).toBe("scheduled");
    const sent = runNotice(updated, "2026-09-03T19:00");
    expect(sent.sentRevision).toBe(2);
    expect(runNotice(sent, "2026-09-03T20:00")).toBe(sent);
    const changed = saveMove({ ...sent, notifyTime: "20:00", assigneeId: "driver-1" }, sent, "2026-09-03T19:00");
    expect(changed.noticeKind).toBe("change");
    expect(messages(changed).find(message => message.personId === "driver-4")?.text).toContain("対応は不要です");
  });
  it("未送信の取消は予約を消し、送信後の取消は取消連絡を残す", () => {
    const planned = saveMove(draft(), draft(), previewNow);
    expect(cancelMove(planned, previewNow).notice).toBe("none");
    const cancelled = cancelMove(runNotice(planned, "2026-09-03T18:00"), "2026-09-03T18:30");
    expect(cancelled.notice).toBe("scheduled");
    expect(messages(cancelled).every(message => message.text.includes("取り消しました"))).toBe(true);
  });
  it("役割が重なる宛先は一通にまとめ、給油は指定された人にだけ依頼する", () => {
    const output = messages({ ...draft(), assigneeId: "driver-1", fuel: true, fuelPersonId: "driver-4" });
    expect(output.filter(message => message.personId === "driver-1")).toHaveLength(1);
    expect(output.find(message => message.personId === "driver-4")?.text).toContain("引き渡し前に満タン給油");
    expect(output.find(message => message.personId === "driver-2")?.text).not.toContain("引き渡し前に満タン給油");
    expect(output.find(message => message.personId === "driver-2")?.text).toContain("返却時");
    const pickup = messages({ ...suggestMoves(sampleUses)[2], assigneeId: "driver-2" }).find(message => message.personId === "driver-2")!.text;
    expect(pickup).toContain("車を受け取ってください");
    expect(pickup).not.toContain("田中さんへの受け渡し");
  });
  it("手配・通知だけでは実位置を変えず、到着時の実際の場所を別に記録する", () => {
    const planned = saveMove(draft(), draft(), previewNow);
    const failed = runNotice(planned, "2026-09-03T18:00", true);
    expect(failed.notice).toBe("failed");
    expect(failed.actualPlaceId).toBeUndefined();
    const arrived = markArrived(planned, "suita", "2026-09-04T06:20");
    expect(arrived.actualPlaceId).toBe("suita");
    expect(arrived.toPlaceId).toBe("kyoto");
    expect(arrived.state).toBe("planned");
    expect(markArrived(planned, "kyoto", "2026-09-04T06:20").notice).toBe("none");
    expect(() => markArrived(draft(), "kyoto", "2026-09-04T06:20")).toThrow(/先に移動/);
  });
});
