// mobile/src/components/CaptureActions.tsxの配置・配色を複製する。操作順も同じに保つ。
export function CaptureActions({ onRetake, onConfirm, confirmLabel = "この写真を使う", retakeLabel = "撮り直す", disabled = false }: {
  onRetake: () => void; onConfirm: () => void; confirmLabel?: string; retakeLabel?: string; disabled?: boolean;
}) {
  return <div data-testid="capture-actions" style={{ display: "flex", alignItems: "stretch", gap: 12 }}>
    <button disabled={disabled} data-testid="capture-retake" onClick={onRetake} style={{ flex: 1, minWidth: 0, minHeight: 56, padding: "14px 10px", borderRadius: 16, border: "1px solid #68717D", background: "#10151DD9", color: "#E2E6EC", fontSize: 14, textAlign: "center", whiteSpace: "pre-line" }}>{retakeLabel}</button>
    <button disabled={disabled} data-testid="capture-confirm" onClick={onConfirm} style={{ flex: 1.5, minWidth: 0, minHeight: 56, padding: "14px 12px", borderRadius: 16, background: "#FFC52C", color: "#192333", fontSize: 16, fontWeight: 600, textAlign: "center", whiteSpace: "pre-line" }}>{confirmLabel}</button>
  </div>;
}
