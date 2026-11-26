import { useCallback, useEffect, useRef } from "react";

export const PARKING_DRAG_SLOP = 9;
const HOLD_MS = 500;

export function useParkingLongPress(place: (x: number, y: number) => void) {
  const callback = useRef(place);
  callback.current = place;
  const hold = useRef<{ id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const fired = useRef(false);
  const clear = useCallback(() => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  return {
    start(id: number, x: number, y: number) {
      clear();
      fired.current = false;
      hold.current = { id, x, y, timer: setTimeout(() => { fired.current = true; callback.current(x, y); clear(); }, HOLD_MS) };
    },
    move(id: number, x: number, y: number) {
      const p = hold.current;
      if (p && (id !== p.id || Math.hypot(x - p.x, y - p.y) > PARKING_DRAG_SLOP)) clear();
    },
    finish() { clear(); return fired.current; },
  };
}
