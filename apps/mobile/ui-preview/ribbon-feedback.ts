export type RibbonFeedback = "grab" | "tick" | "ready" | "release";

// 時間で振動を予約せず、移動量の節目だけを知らせる。
export function createRibbonFeedback(emit: (kind: RibbonFeedback) => void, enabled: () => boolean) {
  let started = false, ready = false;
  const pulse = (kind: RibbonFeedback) => {
    if (!enabled()) return;
    emit(kind);
  };
  return {
    start() { started = false; ready = false; pulse("grab"); },
    move(progress: number) {
      if (progress >= .12 && !started) { pulse("tick"); started = true; }
      if (progress >= .75 && !ready) { pulse("ready"); ready = true; }
    },
    release() { pulse("release"); },
  };
}
