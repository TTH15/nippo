import { describe, expect, it } from "vitest";
import { fitImageWithin } from "./clientImageCompression";

describe("fitImageWithin", () => {
  it("横長画像を長辺内へ縦横比を保って縮小する", () => {
    expect(fitImageWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("小さい画像は拡大しない", () => {
    expect(fitImageWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("不正な寸法でもcanvasに渡せる最小値へ補正する", () => {
    expect(fitImageWithin(0, 600, 1600)).toEqual({ width: 1, height: 1 });
  });
});
