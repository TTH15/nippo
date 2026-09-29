import { useState, type ReactNode } from "react";
import { NativeModal } from "./NativeModal";
export type YM = { year: number; month: number };
export const ymKey = (m: YM) => `${m.year}-${String(m.month).padStart(2, "0")}`;
export function MonthTitle({ ym, onPress, large }: { ym: YM; onPress: () => void; large?: boolean }) {
  return <button aria-label={`${ym.year}年${ym.month}月、年月を選択`} onClick={onPress} style={{ display: "block", width: "100%", minHeight: 60, fontSize: large ? 23 : 16, fontWeight: 700 }}>{ym.year}年{ym.month}月</button>;
}
export function MonthPager({ ym, onChange, renderMonth }: { ym: YM; onChange: (m: YM) => void; renderMonth: (m: YM, center: boolean) => ReactNode }) {
  const move = (delta: number) => { const d = new Date(ym.year, ym.month - 1 + delta, 1); onChange({ year: d.getFullYear(), month: d.getMonth() + 1 }); };
  return <div><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><button aria-label="前月" onClick={() => move(-1)} style={{ minHeight: 44, padding: 12 }}>前月</button><button aria-label="翌月" onClick={() => move(1)} style={{ minHeight: 44, padding: 12 }}>翌月</button></div>{renderMonth(ym, true)}</div>;
}
export function MonthPickerSheet({ visible, ym, onSelect, onClose }: { visible: boolean; ym: YM; onSelect: (m: YM) => void; onClose: () => void }) {
  const [year, setYear] = useState(ym.year);
  return <NativeModal visible={visible} onRequestClose={onClose}><div style={{ background: "white", padding: 24, width: "100%" }}><button onClick={() => setYear(y => y - 1)} style={{ padding: 12 }}>前年</button>{year}年<button onClick={() => setYear(y => y + 1)} style={{ padding: 12 }}>翌年</button><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>{Array.from({ length: 12 }, (_, i) => <button key={i} style={{ minHeight: 48 }} onClick={() => { onSelect({ year, month: i + 1 }); onClose(); }}>{i + 1}月</button>)}</div><button onClick={onClose} style={{ minHeight: 44 }}>閉じる</button></div></NativeModal>;
}
export function BottomSheet({ visible, children, onClose }: { visible: boolean; children: ReactNode; onClose?: () => void }) { return <NativeModal visible={visible} onRequestClose={onClose}><div style={{ padding: 20, background: "white", overflow: "auto", maxHeight: "90%" }}>{children}</div></NativeModal>; }
