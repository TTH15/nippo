import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { selectedColumnScrollLeft, useSelectedColumnAnchor } from "./useSelectedColumnAnchor";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("固定列と右パネルを除く可視幅を使い、日付列の拡大・固定列・パネル幅の変更に合わせる", () => {
  expect(selectedColumnScrollLeft(9,76,190,838,1406)).toBe(398);
  expect(selectedColumnScrollLeft(9,140,190,838,2430)).toBe(1006);
  expect(selectedColumnScrollLeft(9,76,300,838,1516)).toBe(453);
  expect(selectedColumnScrollLeft(9,76,190,700,1406)).toBe(467);
});
it("スクロールの左右端では到達できる範囲に収める", () => {
  expect(selectedColumnScrollLeft(0,76,190,838,1406)).toBe(0);
  expect(selectedColumnScrollLeft(15,76,190,838,1406)).toBe(568);
  expect(selectedColumnScrollLeft(9,76,190,1600,1406)).toBe(0);
});
it("幅変更中は列を中央へ戻し、高さ変更や通常の手動スクロールでは追いかけない", () => {
  let notify!: ResizeObserverCallback;
  const disconnect=vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) {notify=callback;}
    observe() {} disconnect=disconnect;
  });
  let viewport=838, content=1406;
  const element=document.createElement("section");
  Object.defineProperties(element,{clientWidth:{get:()=>viewport},scrollWidth:{get:()=>content}});
  const ref={current:element};
  const view=renderHook(({index,width,panel})=>useSelectedColumnAnchor(ref,index,width,190,true,panel),{initialProps:{index:9,width:76,panel:330}});
  expect(element.scrollLeft).toBe(398);
  element.scrollLeft=250;
  notify([],{} as ResizeObserver); // 高さだけの通知は手動スクロールを維持
  expect(element.scrollLeft).toBe(250);
  viewport=700;view.rerender({index:9,width:76,panel:430});
  expect(element.scrollLeft).toBe(467);
  viewport=600;notify([],{} as ResizeObserver);
  expect(element.scrollLeft).toBe(517);
  viewport=700;notify([],{} as ResizeObserver);
  content=2430;view.rerender({index:9,width:140,panel:430});
  expect(element.scrollLeft).toBe(1075);
  view.rerender({index:-1,width:140,panel:430});
  element.scrollLeft=100;viewport=600;window.dispatchEvent(new Event("resize"));
  expect(element.scrollLeft).toBe(100);
  expect(disconnect).toHaveBeenCalled();
});
