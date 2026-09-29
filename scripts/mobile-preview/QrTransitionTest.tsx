import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrScanMotion, qrMotionCss } from "./QrScanMotion";
import type { QrFrameState } from "../../apps/mobile/src/components/QrScanFrame";

const testPayload = "HAKOTORA-QR-UI-TEST";

export function QrTransitionTest() {
  const [image, setImage] = useState("");
  const [state, setState] = useState<QrFrameState>("searching");
  const [next, setNext] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(testPayload, { width: 248, margin: 2, color: { dark: "#202B36", light: "#FFFFFF" } }).then(value => { if (active) setImage(value); });
    return () => { active = false; clear(); };
  }, []);
  const run = (outcome: "ok" | "rejected") => {
    clear(); setNext(false); setState("searching");
    timers.current.push(setTimeout(() => setState("verifying"), 80));
    timers.current.push(setTimeout(() => setState(outcome === "ok" ? "verified" : "rejected"), 540));
    if (outcome === "ok") timers.current.push(setTimeout(() => setNext(true), 1540));
  };
  const reset = () => { clear(); setState("searching"); setNext(false); };
  return <section aria-label="QR読取テスト" style={{ color: "#202B36", padding: "20px 16px 40px" }}>
    <style>{qrMotionCss}</style>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 14 }}>QR読取テスト</h1>
    <div style={{ position: "relative", background: "#202B36", color: "white", borderRadius: 22, minHeight: 340, padding: "18px 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      {next ? <div role="status" style={{ minHeight: 232, display: "grid", placeItems: "center", textAlign: "center", fontSize: 23, fontWeight: 700 }}>安全確認へ</div> : <><QrScanMotion state={state} /><p role="status" style={{ fontSize: 17, fontWeight: 600, margin: 0, textAlign: "center" }}>{state === "searching" ? "貼付したQRを枠に入れる" : state === "verifying" ? "車両を確認中" : state === "verified" ? "読み取り完了" : "確認できませんでした"}</p></>}
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button onClick={() => run("ok")} style={buttonStyle}>読取成功を試す</button><button onClick={() => run("rejected")} style={secondaryStyle}>失敗を試す</button></div>
    <button onClick={reset} style={{ ...secondaryStyle, width: "100%", marginTop: 8 }}>最初から</button>
    <div style={{ marginTop: 14, padding: 12, background: "#F2F5F8", borderRadius: 18, textAlign: "center" }}>
      <strong style={{ display: "block", marginBottom: 6 }}>iPhoneで読む見本QR</strong>
      {image && <img src={image} width={152} height={152} alt="iPhoneで読む見本QR" style={{ maxWidth: "100%", borderRadius: 10 }} />}
      <p style={{ margin: "4px 0 0", color: "#65717C", fontSize: 12 }}>画面確認用・車両データとの紐付けなし</p>
    </div>
  </section>;
}

const buttonStyle = { flex: 1, minHeight: 50, padding: "8px 10px", borderRadius: 12, background: "#FFC52C", fontWeight: 700, color: "#192333" } as const;
const secondaryStyle = { flex: 1, minHeight: 50, padding: "8px 10px", borderRadius: 12, background: "#E9EDF1", fontWeight: 700, color: "#26333E" } as const;
