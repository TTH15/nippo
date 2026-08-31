import { describe, expect, it } from "vitest";
import { dateForView, initialShiftView, moveViewByDay, viewAtDate } from "./navigation";

describe("スマホの日付移動", () => {
  it.each([
    ["2026-09-15", 1, "2026-09-16"], ["2026-09-16", -1, "2026-09-15"],
    ["2026-09-30", 1, "2026-10-01"], ["2026-10-01", -1, "2026-09-30"],
    ["2026-12-31", 1, "2027-01-01"], ["2028-02-28", 1, "2028-02-29"],
  ])("%s から %s日移動して %s を表示する", (from, direction, to) => {
    const view = { ...initialShiftView(), labelIds: ["amazon"], showVehicle: false };
    const moved = moveViewByDay(viewAtDate(view, from), direction);
    expect(dateForView(moved)).toBe(to);
    expect(moved.labelIds).toEqual(["amazon"]);
    expect(moved.showVehicle).toBe(false);
  });
});
