import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
// RN Modalの隔離DOMホスト。フォーム・日付・保存処理はネイティブ本体を使う。
export function NativeModal({ visible, children, onRequestClose }: { visible: boolean; children: ReactNode; onRequestClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!visible) return; const previous = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => previous?.focus(); }, [visible]);
  if (!visible) return null;
  return createPortal(<div ref={ref} role="dialog" aria-modal="true" aria-label="希望休の選択" tabIndex={-1} onKeyDown={e => {
    if (e.key === "Escape") onRequestClose?.();
    if (e.key === "Tab") { const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'); if (!nodes?.length) { e.preventDefault(); return; } const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); } }
  }} style={{ position: "absolute", inset: 0, zIndex: 30, background: "#0006", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", color: "#192333" }}>{children}</div>, document.querySelector('[data-testid="session-phone"]') || document.body);
}
