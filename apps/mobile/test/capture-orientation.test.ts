import { expect, it } from "vitest";
import { isLandscapePhoto, isSideAngle, rotationFromGravity } from "../src/capture/orientation";
it("左右だけ横向きにし、センサーのOS別の符号を揃える", () => {
  expect(["front", "right", "rear", "left", "meter"].filter(isSideAngle)).toEqual(["right", "left"]);
  expect(rotationFromGravity(1, 0, 0)).toBe(-90);
  expect(rotationFromGravity(-1, 0, 0)).toBe(90);
  expect(rotationFromGravity(-1, 0, 0, true)).toBe(-90);
  expect(rotationFromGravity(1, 0, 0, true)).toBe(90);
});
it("縦持ち・傾けただけ・平置き・不正値では撮影可能にしない", () => {
  for (const [x,y,z] of [[0,-1,0],[.6,-.6,0],[.8,0,.8],[NaN,0,0],[Infinity,0,0]]) expect(rotationFromGravity(x,y,z)).toBeNull();
});
it("横向き画像だけ採用し、向き切替直後の縦画像を通さない", () => {
  expect(isLandscapePhoto(4032,3024)).toBe(true);
  expect(isLandscapePhoto(3024,4032)).toBe(false);
  expect(isLandscapePhoto(0,0)).toBe(false);
});
