import { describe, expect, it } from "vitest";
import { DISPATCH_IMAGE_MAX_ROWS_PER_PAGE, planDispatchImagePages } from "./dispatchImagePages";

const sizes = (groups: string[]) => planDispatchImagePages(groups).map(page => page.end - page.start);

describe("日別配車画像の改ページ", () => {
  it("12行までは1枚に収める", () => {
    expect(sizes(Array.from({ length: 11 }, () => "course-a"))).toEqual([11]);
    expect(sizes(Array.from({ length: DISPATCH_IMAGE_MAX_ROWS_PER_PAGE }, () => "course-a"))).toEqual([12]);
  });

  it("区切りがない13行はほぼ均等に分ける", () => {
    expect(sizes(Array.from({ length: 13 }, () => "course-a"))).toEqual([6, 7]);
  });

  it("自然な区切りがあれば契約区分・コースの途中を避ける", () => {
    expect(sizes([...Array(10).fill("course-a"), ...Array(3).fill("course-b")])).toEqual([10, 3]);
    expect(sizes([...Array(9).fill("monthly"), ...Array(8).fill("daily"), ...Array(8).fill("none")])).toEqual([9, 8, 8]);
  });

  it("自然な区切りでも2枚目が1行だけなら均等化を優先する", () => {
    const result = sizes([...Array(12).fill("course-a"), "course-b"]);
    expect(result).toEqual([6, 7]);
    expect(result.every(size => size <= DISPATCH_IMAGE_MAX_ROWS_PER_PAGE)).toBe(true);
  });

  it("0行でも空の1枚を返す", () => {
    expect(planDispatchImagePages([])).toEqual([{ start: 0, end: 0 }]);
  });
});
