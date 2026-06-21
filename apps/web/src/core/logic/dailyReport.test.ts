import { describe, it, expect } from "vitest";
import {
  buildInitialValues,
  parseMeter,
  resolveDefaultVehicleId,
  resolveExistingMeter,
  findVehicle,
  buildReportItems,
  buildVehicleCards,
  groupFieldsByLabel,
} from "./dailyReport";
import type { ShiftForm, FieldDef, SubmitVehicle, ValueMap } from "@/core/types";

function field(fieldKey: string, inputType: FieldDef["inputType"], groupLabel: string | null = null): FieldDef {
  return { fieldKey, label: fieldKey, inputType, groupLabel, required: false };
}

function shift(courseId: string, fields: FieldDef[], existing: ShiftForm["existing"] = null): ShiftForm {
  return {
    courseId,
    courseName: courseId,
    color: null,
    carrierId: "c1",
    carrierName: "carrier",
    units: [{ id: "u1", name: "u1", code: null, billingType: "PER_PIECE", fields }],
    existing,
  };
}

const veh = (id: string, over: Partial<SubmitVehicle> = {}): SubmitVehicle => ({ id, ...over });

describe("buildInitialValues", () => {
  it("既存値で初期化、未入力は空文字", () => {
    const shifts = [
      shift("co1", [field("qty", "INT"), field("note", "TEXT")], {
        vehicleId: null,
        meterValue: null,
        values: { u1: { qty: 12 } },
      }),
    ];
    expect(buildInitialValues(shifts)).toEqual({ co1: { u1: { qty: "12", note: "" } } });
  });
  it("existing なしは全て空文字", () => {
    expect(buildInitialValues([shift("co1", [field("qty", "INT")])])).toEqual({
      co1: { u1: { qty: "" } },
    });
  });
});

describe("parseMeter", () => {
  it("数値化、空白・空文字は null", () => {
    expect(parseMeter("14567")).toBe(14567);
    expect(parseMeter("  ")).toBeNull();
    expect(parseMeter("")).toBeNull();
  });
});

describe("resolveDefaultVehicleId", () => {
  const shifts = [shift("co1", [], { vehicleId: "ex1", meterValue: null, values: {} })];
  it("シフト割当車両を最優先", () => {
    expect(resolveDefaultVehicleId(shifts, "sv1")).toBe("sv1");
  });
  it("シフト割当が無ければ既存reportの車両", () => {
    expect(resolveDefaultVehicleId(shifts, null)).toBe("ex1");
  });
  it("どちらも無ければ null", () => {
    expect(resolveDefaultVehicleId([shift("co1", [])], null)).toBeNull();
  });
});

describe("resolveExistingMeter", () => {
  it("既存メーターを文字列で、無ければ空文字", () => {
    expect(resolveExistingMeter([shift("co1", [], { vehicleId: null, meterValue: 1000, values: {} })])).toBe("1000");
    expect(resolveExistingMeter([shift("co1", [])])).toBe("");
  });
});

describe("findVehicle", () => {
  const vehicles = [veh("v1")];
  const unlinked = [veh("u1")];
  it("紐付け・未紐付けの両方から検索", () => {
    expect(findVehicle(vehicles, unlinked, "u1")?.id).toBe("u1");
  });
  it("id が null・不在なら null", () => {
    expect(findVehicle(vehicles, unlinked, null)).toBeNull();
    expect(findVehicle(vehicles, unlinked, "x")).toBeNull();
  });
});

describe("buildReportItems", () => {
  it("INT は valueNum（空は0）、それ以外は valueText", () => {
    const shifts = [shift("co1", [field("qty", "INT"), field("note", "TEXT")])];
    const values: ValueMap = { co1: { u1: { qty: "5", note: "hello" } } };
    const items = buildReportItems(shifts, values, "v1", 14567);
    expect(items).toEqual([
      {
        courseId: "co1",
        carrierId: "c1",
        vehicleId: "v1",
        meterValue: 14567,
        entries: [
          { unitId: "u1", fieldKey: "qty", valueNum: 5, valueText: null },
          { unitId: "u1", fieldKey: "note", valueNum: null, valueText: "hello" },
        ],
      },
    ]);
  });
  it("INT の空入力は valueNum:0", () => {
    const shifts = [shift("co1", [field("qty", "INT")])];
    const items = buildReportItems(shifts, { co1: { u1: { qty: "" } } }, null, null);
    expect(items[0].entries[0]).toEqual({ unitId: "u1", fieldKey: "qty", valueNum: 0, valueText: null });
  });
  it("未入力フィールドは valueText:''（TEXT）", () => {
    const shifts = [shift("co1", [field("note", "TEXT")])];
    const items = buildReportItems(shifts, {}, null, null);
    expect(items[0].entries[0]).toEqual({ unitId: "u1", fieldKey: "note", valueNum: null, valueText: "" });
  });
});

describe("buildVehicleCards", () => {
  it("紐付け車両のみ", () => {
    const r = buildVehicleCards({
      vehicles: [veh("v1"), veh("v2")],
      unlinked: [veh("u1")],
      vehicleId: null,
      shiftVehicleId: null,
      showOtherVehicles: false,
    });
    expect(r.cards.map((c) => c.id)).toEqual(["v1", "v2"]);
    expect(r.linkedIds.has("v1")).toBe(true);
    expect(r.hasMoreOthers).toBe(true); // u1 未表示
  });
  it("選択中の未紐付け車両はカードに追加される", () => {
    const r = buildVehicleCards({
      vehicles: [veh("v1")],
      unlinked: [veh("u1")],
      vehicleId: "u1",
      shiftVehicleId: null,
      showOtherVehicles: false,
    });
    expect(r.cards.map((c) => c.id)).toEqual(["v1", "u1"]);
  });
  it("シフト割当車両は先頭にサジェスト（重複排除）", () => {
    const r = buildVehicleCards({
      vehicles: [veh("v1"), veh("v2")],
      unlinked: [],
      vehicleId: null,
      shiftVehicleId: "v2",
      showOtherVehicles: false,
    });
    expect(r.cards.map((c) => c.id)).toEqual(["v2", "v1"]);
  });
  it("showOtherVehicles で未紐付けを展開、全表示で hasMoreOthers=false", () => {
    const r = buildVehicleCards({
      vehicles: [veh("v1")],
      unlinked: [veh("u1"), veh("u2")],
      vehicleId: null,
      shiftVehicleId: null,
      showOtherVehicles: true,
    });
    expect(r.cards.map((c) => c.id)).toEqual(["v1", "u1", "u2"]);
    expect(r.hasMoreOthers).toBe(false);
  });
});

describe("groupFieldsByLabel", () => {
  it("groupLabel ごとにまとめ、null は空キー、挿入順を維持", () => {
    const fields = [
      field("a", "INT", null),
      field("b", "INT", "G1"),
      field("c", "INT", "G1"),
      field("d", "INT", null),
    ];
    const groups = groupFieldsByLabel(fields);
    expect(groups.map(([k, fs]) => [k, fs.map((f) => f.fieldKey)])).toEqual([
      ["", ["a", "d"]],
      ["G1", ["b", "c"]],
    ]);
  });
});
