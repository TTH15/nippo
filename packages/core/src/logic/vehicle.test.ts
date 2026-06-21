import { describe, it, expect } from "vitest";
import { dedupeVehiclesById, excludeVehicleId, resolvePreferredVehicleId } from "./vehicle";

const v = (id: string) => ({ id });

describe("dedupeVehiclesById", () => {
  it("複数リストを結合し id 重複を排除（先勝ち）", () => {
    expect(dedupeVehiclesById([v("a"), v("b")], [v("b"), v("c")]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("空でも落ちない", () => {
    expect(dedupeVehiclesById<{ id: string }>([], [])).toEqual([]);
  });
});

describe("excludeVehicleId", () => {
  it("指定 id を除外", () => {
    expect(excludeVehicleId([v("a"), v("b")], "a").map((x) => x.id)).toEqual(["b"]);
  });
  it("id が null なら素通し", () => {
    expect(excludeVehicleId([v("a"), v("b")], null)).toHaveLength(2);
  });
});

describe("resolvePreferredVehicleId", () => {
  it("優先車両が連携車両にあればそれ", () => {
    expect(resolvePreferredVehicleId([v("a"), v("b")], "b")).toBe("b");
  });
  it("優先が連携外なら先頭", () => {
    expect(resolvePreferredVehicleId([v("a"), v("b")], "z")).toBe("a");
  });
  it("優先 null でも先頭", () => {
    expect(resolvePreferredVehicleId([v("a")], null)).toBe("a");
  });
  it("連携が空なら null", () => {
    expect(resolvePreferredVehicleId<{ id: string }>([], "a")).toBeNull();
  });
});
