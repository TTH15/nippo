import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMemoNavigationGuard, useShiftPeriod } from "./workspace";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelectorAll("[data-test-nav]").forEach(node => node.remove()); });
it("期間を更新して再入場しても同じ年月と前後半を復元する", () => {
  const first = renderHook(() => useShiftPeriod({year:2026,month:10},"second"));
  act(() => {first.result.current.setYearMonth({year:2027,month:1});first.result.current.setPeriod("first");});
  first.unmount();
  const next=renderHook(() => useShiftPeriod({year:2026,month:10},"second"));
  expect(next.result.current.yearMonth).toEqual({year:2027,month:1});
  expect(next.result.current.period).toBe("first");
});
it("保存先が使用不可でも初期期間を表示できる", () => {
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(() => {throw Error("blocked");});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(() => {throw Error("blocked");});
  const view=renderHook(() => useShiftPeriod({year:2026,month:10},"second"));
  expect(view.result.current.yearMonth).toEqual({year:2026,month:10});
});
it("共有メモが未保存のとき、取消で通常のリンク遷移を止め、保存完了後は止めない", () => {
  const confirm=vi.fn(() => false);vi.stubGlobal("confirm",confirm);
  const link=document.createElement("a");link.href="/admin/shifts";link.dataset.testNav="true";document.body.append(link);
  const view=renderHook(({pending})=>useMemoNavigationGuard(pending),{initialProps:{pending:true}});
  const cancelled=new MouseEvent("click",{bubbles:true,cancelable:true});link.dispatchEvent(cancelled);
  expect(confirm).toHaveBeenCalledTimes(1);expect(cancelled.defaultPrevented).toBe(true);
  const newTab=new MouseEvent("click",{bubbles:true,cancelable:true,ctrlKey:true});link.dispatchEvent(newTab);
  expect(confirm).toHaveBeenCalledTimes(1);
  view.rerender({pending:false});
  const saved=new MouseEvent("click",{bubbles:true,cancelable:true});link.dispatchEvent(saved);
  expect(saved.defaultPrevented).toBe(false);expect(confirm).toHaveBeenCalledTimes(1);
});
