import { describe, expect, it, vi } from "vitest";
import { createFrameLoop } from "../ui-preview/scene/frame-loop";

function harness() {
  const queued = new Map<number, (time: number) => void>(); let id = 0;
  const draw = vi.fn();
  const loop = createFrameLoop(draw, { request: callback => { queued.set(++id, callback); return id; }, cancel: id => { queued.delete(id); } });
  const frame = (time: number) => { const batch = [...queued.values()]; queued.clear(); batch.forEach(callback => callback(time)); };
  return { loop, draw, queued, frame };
}
describe("3D scene frame lifecycle", () => {
  it("caps animation at 30 submissions per second on a 120Hz display", () => {
    const h = harness(); h.loop.setActive(true, true);
    for (let i = 0; i <= 120; i++) h.frame(i * 1000 / 120);
    expect(h.draw.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(h.draw.mock.calls.length).toBeLessThanOrEqual(31);
    expect(h.queued.size).toBe(1); h.loop.dispose(); expect(h.queued.size).toBe(0);
  });
  it("stops all scheduled work when hidden and does not jump after backgrounding", () => {
    const h = harness(); h.loop.setActive(true, true); h.frame(0); h.frame(34);
    h.loop.setActive(false, true); const count = h.draw.mock.calls.length;
    expect(h.queued.size).toBe(0); h.frame(60_000); expect(h.draw).toHaveBeenCalledTimes(count);
    h.loop.setActive(true, true); h.frame(60_000); h.frame(60_034);
    expect(h.draw.mock.calls.at(-1)?.[0]).toBeCloseTo(.034);
  });
  it("renders idle/reduced-motion once and never creates duplicate loops", () => {
    const h = harness(); h.loop.setActive(true, false); expect(h.draw).toHaveBeenCalledOnce(); expect(h.queued.size).toBe(0);
    h.loop.setActive(true, true); h.loop.setActive(true, true); expect(h.queued.size).toBe(1);
    h.loop.setActive(true, false); expect(h.queued.size).toBe(0);
  });
});
