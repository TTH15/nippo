import { describe, expect, it } from "vitest";
import { sortShiftDriverOrder, type ShiftDriverOrderItem } from "./ShiftDriverOrderDialog";

const items: ShiftDriverOrderItem[] = [
  { id: "a", name: "佐藤", leaseMode: "DAILY", courseName: "Amazon", courseColor: null, courseOrder: 20 },
  { id: "b", name: "田中", leaseMode: "MONTHLY", courseName: "ヤマト", courseColor: null, courseOrder: 10 },
  { id: "c", name: "高橋", leaseMode: "DAILY", courseName: "ヤマト", courseColor: null, courseOrder: 10 },
  { id: "d", name: "伊藤", leaseMode: "NONE", courseName: null, courseColor: null, courseOrder: null },
];

describe("シフト表の行のまとめ直し", () => {
  it("契約区分内では現在の手動順を維持する", () => {
    expect(sortShiftDriverOrder(items, "lease").map(item => item.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("コース順にまとめ、同じコース内では現在の手動順を維持する", () => {
    expect(sortShiftDriverOrder(items, "course").map(item => item.id)).toEqual(["b", "c", "a", "d"]);
  });
});
