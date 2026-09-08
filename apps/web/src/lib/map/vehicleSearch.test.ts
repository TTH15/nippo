import { describe, expect, it } from "vitest";
import { matchScore, matchVehicles, normalizeQuery, type VehicleSearchTarget } from "./vehicleSearch";

const acty: VehicleSearchTarget = {
  id: "acty",
  number_prefix: "京都",
  number_class: "480",
  number_hiragana: "り",
  number_numeric: "10-00",
  manufacturer: "ホンダ",
  brand: "アクティバン",
  driverName: "島本壮",
  hasPosition: true,
};
const hijet: VehicleSearchTarget = {
  id: "hijet",
  number_prefix: "大阪",
  number_class: "480",
  number_hiragana: "わ",
  number_numeric: "58-54",
  manufacturer: "ダイハツ",
  brand: "ハイゼットカーゴ",
  driverName: null,
  hasPosition: false,
};
const every: VehicleSearchTarget = {
  id: "every",
  number_prefix: "京都",
  number_class: "800",
  number_hiragana: "れ",
  number_numeric: "10-37",
  brand: "エブリイ",
  hasPosition: true,
};
const all = [acty, hijet, every];

describe("normalizeQuery", () => {
  it("全角・区切り・大小をそろえる", () => {
    expect(normalizeQuery("１０-００")).toBe("1000");
    expect(normalizeQuery(" 58 54 ")).toBe("5854");
    expect(normalizeQuery("ABC")).toBe("abc");
  });
});

describe("matchScore", () => {
  it("4桁の一致は前方・部分より強い", () => {
    expect(matchScore(acty, "1000")).toBe(0);
    expect(matchScore(acty, "10")).toBe(1);
    expect(matchScore(acty, "00")).toBe(2);
  });
  it("区切りや全角が入っていても4桁に当たる", () => {
    expect(matchScore(acty, "10-00")).toBe(0);
    expect(matchScore(acty, "１０００")).toBe(0);
  });
  it("地名・かな・車種・ドライバー名でも引ける", () => {
    expect(matchScore(acty, "京都")).toBe(3);
    expect(matchScore(hijet, "わ")).toBe(3);
    expect(matchScore(hijet, "ハイゼット")).toBe(3);
    expect(matchScore(acty, "島本")).toBe(3);
    expect(matchScore(acty, "アクティ")).toBe(3);
  });
  it("当たらないものは null、空文字も null", () => {
    expect(matchScore(acty, "9999")).toBeNull();
    expect(matchScore(acty, "スバル")).toBeNull();
    expect(matchScore(acty, "  ")).toBeNull();
  });
});

describe("matchVehicles", () => {
  it("強い順に返し、同じ強さなら位置がある車を先に出す", () => {
    expect(matchVehicles(all, "10").map((v) => v.id)).toEqual(["acty", "every"]);
    expect(matchVehicles(all, "480").map((v) => v.id)).toEqual(["acty", "hijet"]);
    // 分類番号は完全一致だけ。「48」で 480 の車が全部並ばない
    expect(matchVehicles(all, "48").map((v) => v.id)).toEqual([]);
    expect(matchVehicles(all, "58").map((v) => v.id)).toEqual(["hijet"]);
  });
  it("位置が無い車も候補に出す（そのまま置けるようにするため）", () => {
    expect(matchVehicles(all, "5854").map((v) => v.id)).toEqual(["hijet"]);
  });
  it("件数の上限を守る", () => {
    expect(matchVehicles(all, "京都", 1)).toHaveLength(1);
  });
  it("当たらなければ空", () => {
    expect(matchVehicles(all, "ZZZ")).toEqual([]);
  });
});
