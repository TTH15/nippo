// 非表示/背景化でRAF自体を止める。復帰時に経過分を一気に進めない。
export function createFrameLoop(draw: (seconds: number) => void, clock = {
  request: (callback: (time: number) => void) => requestAnimationFrame(callback),
  cancel: (id: number) => cancelAnimationFrame(id),
}) {
  let id: number | undefined;
  let previous: number | undefined;
  let running = false;
  const tick = (time: number) => {
    if (!running) return;
    if (previous === undefined) previous = time;
    const elapsed = time - previous;
    if (elapsed >= 1000 / 30 - .1) { previous = time; draw(Math.min(elapsed / 1000, .1)); }
    if (running) id = clock.request(tick);
  };
  return {
    setActive(visible: boolean, animate: boolean) {
      running = false; if (id !== undefined) clock.cancel(id); id = undefined; previous = undefined;
      if (!visible) return;
      draw(0);
      if (animate) { running = true; id = clock.request(tick); }
    },
    dispose() { running = false; if (id !== undefined) clock.cancel(id); id = undefined; },
  };
}
