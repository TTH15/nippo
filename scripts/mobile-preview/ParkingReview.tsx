import { ParkingPreview } from "../../apps/mobile/ui-preview/ParkingPreview";
// 実機の隔離プレビューをそのまま再利用。撮影/位置/送信は架空データ。
export function ParkingReview(props: { onSaved: (located: boolean) => void; onLater: () => void; initialStep?: "place" }) {
  return <div role="dialog" aria-modal="true" aria-label="駐車場所の記録" style={{ position: "absolute", inset: 0, zIndex: 6, background: "#F6F8FB", color: "#192333", overflowY: "auto" }}><ParkingPreview {...props} /></div>;
}
