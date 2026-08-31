import { describe, expect, it } from "vitest";
import { initialDemo, shiftFor } from "./model";
import { initialShiftView } from "./navigation";
import { buildDayImageData } from "./shiftImage";
import { countDayDrivers } from "./dayFilter";

describe("日別配車画像の内容", () => {
  it("ラベル・契約・名前の絞り込みをすべて反映する", () => {
    const data = buildDayImageData(initialDemo(), { ...initialShiftView(), labelIds: ["amazon"], mode: "DAILY", query: "伊藤" }, "2026-09-01", "all");
    expect(data.rows.map(row => row.name)).toEqual(["伊藤 彩"]);
    expect(data.filters).toContain("Amazon / 日額リース / 名前：伊藤");
  });
  it("稼働中のみでは希望休・未割当を除外し、人数も一致する", () => {
    const all = buildDayImageData(initialDemo(), initialShiftView(), "2026-09-01", "all");
    const working = buildDayImageData(initialDemo(), initialShiftView(), "2026-09-01", "working");
    expect(all.rows).toHaveLength(9);
    expect(working.rows).toHaveLength(all.working);
    expect(working.rows.every(row => row.status === "稼働")).toBe(true);
  });
  it("画面で隠した車両やシフトを画像にも含めない", () => {
    const data = buildDayImageData(initialDemo(), { ...initialShiftView(), showVehicle: false, showShift: false, showMeetingTime: true }, "2026-09-02", "working");
    expect(data.rows.every(row => !row.vehicle && !row.vehicleText && !row.loanText && !row.courses.length)).toBe(true);
    expect(data.rows.every(row => row.meetingTime)).toBe(true);
  });
  it("普段の紐付けではなく、その日の貸出車と貸出表示を出す", () => {
    const data = buildDayImageData(initialDemo(), initialShiftView(), "2026-09-02", "all");
    expect(data.rows.find(row => row.id === "takahashi")?.vehicle?.id).toBe("v1");
    expect(data.rows.find(row => row.id === "takahashi")?.loanText).toBe("一時借用");
    expect(data.rows.find(row => row.id === "sato")?.loanText).toBe("車両を貸出");
  });
  it("選択中の未割当タブを引き継ぎ、希望休とコースのない日を含める", () => {
    const demo = initialDemo();
    Object.assign(shiftFor(demo, "sato", "2026-09-01")!, { status: "empty", courseId: "", courseIds: [] });
    // 車両だけ残っていても、コースの割当がなければ稼働には数えない。
    Object.assign(shiftFor(demo, "suzuki", "2026-09-01")!, { status: "work", courseId: "", courseIds: [] });
    const view = { ...initialShiftView(), dayFilter: "unassigned" as const };
    const data = buildDayImageData(demo, view, "2026-09-01");
    expect(data.rows.map(row => row.id)).toEqual(["sato", "tanaka", "suzuki", "kobayashi"]);
    expect(data.rows.filter(row => row.status === "希望休")).toHaveLength(2);
    expect(data.rows.every(row => !row.vehicle && row.courses.length === 0)).toBe(true);
    const counts = countDayDrivers(demo, demo.drivers, "2026-09-01");
    expect(counts).toEqual({ all: 9, working: 5, unassigned: 4 });
    expect(data.rows).toHaveLength(counts.unassigned);
    const otherDate = countDayDrivers(demo, demo.drivers, "2026-09-02");
    expect(buildDayImageData(demo, view, "2026-09-02").rows).toHaveLength(otherDate.unassigned);
    expect(otherDate.working).not.toBe(counts.working);
  });

  it("シフトだけの画像では補足情報を畳み、表示を戻しても対象者は変わらない", () => {
    const demo = initialDemo();
    const view = { ...initialShiftView(), showVehicle: false, grouped: false, labelIds: ["amazon"] };
    const compact = buildDayImageData(demo, view, "2026-09-01");
    expect(compact.compact).toBe(true);
    expect(compact.showDriverDetails).toBe(false);
    expect(compact.rows.every(row => row.labels.length === 0 && !row.vehicle && !row.vehicleText)).toBe(true);
    expect(compact.filters).toContain("Amazon");
    const detailed = buildDayImageData(demo, { ...view, showDriverDetails: true }, "2026-09-01");
    expect(detailed.compact).toBe(false);
    expect(detailed.rows.map(row => row.id)).toEqual(compact.rows.map(row => row.id));
    expect(detailed.rows.every(row => row.labels.includes("Amazon"))).toBe(true);
    const hidden = buildDayImageData(demo, { ...view, showVehicle: true, showDriverDetails: false }, "2026-09-01");
    expect(hidden.showDriverDetails).toBe(false);
    expect(hidden.rows.some(row => row.vehicle)).toBe(true);
  });

});
