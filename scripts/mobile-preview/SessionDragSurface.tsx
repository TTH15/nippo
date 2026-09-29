import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { quickDisclosureTransition } from "../../apps/web/src/lib/ui/motion";

// native SessionSheetと同じ、内容先頭での下ドラッグとリボン優先をブラウザで確認する。
export function SessionDragSurface({ children, blocked, ribbonActive, scroll, onClose, label }: {
  children: ReactNode; blocked: boolean; ribbonActive: boolean; scroll: RefObject<HTMLDivElement | null>; onClose: () => void; label: string;
}) {
  const [offset, setOffset] = useState(0), [touchPanning, setTouchPanning] = useState(false), [atTop, setAtTop] = useState(true);
  const drag = useRef<{ id: number; x: number; y: number; scroll: number } | null>(null);
  const reset = () => { drag.current = null; setOffset(0); setTouchPanning(false); };
  useEffect(() => {
    const element = scroll.current;
    const update = () => setAtTop((element?.scrollTop ?? 0) <= 1);
    element?.addEventListener("scroll", update); update();
    const hidden = () => { if (document.hidden) reset(); };
    window.addEventListener("blur", reset); document.addEventListener("visibilitychange", hidden);
    return () => { element?.removeEventListener("scroll", update); window.removeEventListener("blur", reset); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  return <div inert={blocked} role="dialog" aria-modal="true" aria-label={label} data-testid="session-drag-surface" data-offset={offset}
    onKeyDown={e => { if (e.key === "Escape" && !blocked) onClose(); }}
    onPointerDown={e => {
      if (blocked || ribbonActive || !e.isPrimary || e.button !== 0 || !atTop || (e.target as HTMLElement).closest('button,input,a,[data-testid="ribbon-track"]')) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, scroll: scroll.current?.scrollTop ?? 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      const d = drag.current; if (!d || d.id !== e.pointerId || ribbonActive) return;
      const dy = e.clientY - d.y;
      if (Math.abs(dy) <= Math.abs(e.clientX - d.x) * 1.3) return;
      setTouchPanning(true);
      if (dy > 0 && d.scroll <= 1) setOffset(dy);
      else if (scroll.current) scroll.current.scrollTop = Math.max(0, d.scroll - dy);
    }}
    onPointerUp={() => { if (offset > 110) onClose(); reset(); }} onPointerCancel={reset} onLostPointerCapture={reset}
    style={{ position: "absolute", inset: "32px 0 0", borderRadius: "28px 28px 0 0", background: "#182B4A", color: "#fff", overflow: "hidden", boxShadow: "0 -15px 30px #0004", touchAction: atTop ? "none" : "pan-y", transform: `translateY(${offset}px)`, transition: touchPanning || matchMedia('(prefers-reduced-motion: reduce)').matches ? "none" : `transform ${quickDisclosureTransition.duration}s ease-out` }}>
    {children}
  </div>;
}
