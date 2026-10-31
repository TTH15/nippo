import { afterEach, expect, it, vi } from "vitest";
import { scrollAdminNavItemIntoView } from "./scrollAdminNavItemIntoView";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

function setup(bottom: number) {
  document.body.innerHTML = '<nav><div id="panel"><a aria-current="page">シフトメモ</a></div></nav>';
  const nav = document.querySelector("nav")!;
  const panel = document.getElementById("panel")!;
  const target = panel.querySelector("a")!;
  vi.spyOn(nav, "getClientRects").mockReturnValue([{ }] as unknown as DOMRectList);
  vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 400 } as DOMRect);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: bottom - 44, bottom } as DOMRect);
  nav.scrollTop = 20; nav.scrollLeft = 7; document.body.scrollTop = 9;
  return { nav, panel };
}

it("項目が見えていればメニュー位置を動かさない", () => {
  const { nav, panel } = setup(250);
  scrollAdminNavItemIntoView(panel);
  expect(nav.scrollTop).toBe(20);
});

it("下端が隠れている場合もメニュー内の縦位置だけを補正する", () => {
  const { nav, panel } = setup(450);
  scrollAdminNavItemIntoView(panel);
  expect(nav.scrollTop).toBe(70);
  expect(nav.scrollLeft).toBe(7);
  expect(document.body.scrollTop).toBe(9);
});
