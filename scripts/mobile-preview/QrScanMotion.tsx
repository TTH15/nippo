import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faSquare } from "@fortawesome/free-solid-svg-icons";
import type { QrFrameState } from "../../apps/mobile/src/components/QrScanFrame";

export type QrPoint = { x: number; y: number };
export type QrMotionTarget = {
  box: { x: number; y: number; width: number; height: number; angleDeg: number };
  corners: [QrPoint, QrPoint, QrPoint, QrPoint];
  finders: [QrPoint, QrPoint, QrPoint];
};

const defaultTarget: QrMotionTarget = {
  box: { x: 0, y: 0, width: 232, height: 232, angleDeg: 0 },
  corners: [{ x: 0, y: 0 }, { x: 232, y: 0 }, { x: 232, y: 232 }, { x: 0, y: 232 }],
  finders: [{ x: 35, y: 35 }, { x: 197, y: 35 }, { x: 35, y: 197 }],
};
const resting: QrPoint[] = [{ x: 94, y: 94 }, { x: 138, y: 94 }, { x: 94, y: 138 }];

export function QrScanMotion({ state, target }: { state: QrFrameState; target?: QrMotionTarget | null }) {
  const active = state === "verifying" || state === "verified";
  const destination = target ?? defaultTarget;
  const { box, finders } = destination;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const finderSize = active ? Math.max(22, Math.min(38, Math.min(box.width, box.height) * .16)) : 32;
  const shape = state === "verified" ? { left: center.x - 54, top: center.y - 54, width: 108, height: 108, borderRadius: 54, transform: "rotate(0deg)" } : active ? { left: box.x, top: box.y, width: box.width, height: box.height, borderRadius: 0, transform: `rotate(${box.angleDeg}deg)` } : { left: 0, top: 0, width: 232, height: 232, borderRadius: 0, transform: "rotate(0deg)" };
  const edges = destination.corners.map((start, index) => {
    const end = destination.corners[(index + 1) % 4];
    const width = Math.hypot(end.x - start.x, end.y - start.y);
    return { left: (start.x + end.x - width) / 2, top: (start.y + end.y) / 2 - 2.5, width, transform: `rotate(${Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI}deg)` };
  });
  return <div className="qr-motion" data-state={state} data-has-target={!!target} aria-hidden="true">
    <div className="qr-motion-shape" style={shape} />
    {edges.map((edge, index) => <div key={index} className="qr-motion-edge" style={edge} />)}
    {resting.map((origin, index) => {
      const point = active ? finders[index] : origin;
      return <span className="qr-motion-finder" key={index} style={{ left: point.x - finderSize / 2, top: point.y - finderSize / 2, width: finderSize, height: finderSize }}><FontAwesomeIcon icon={faSquare} /></span>;
    })}
    <FontAwesomeIcon className="qr-motion-check" icon={faCheck} style={{ left: center.x - 29, top: center.y - 29 }} />
  </div>;
}

export const qrMotionCss = `
.qr-motion { width:232px; height:232px; position:relative; flex:none; }
.qr-motion-shape { position:absolute; box-sizing:border-box; border:4px solid white; background:transparent; transition:left .36s cubic-bezier(.2,1.15,.3,1),top .36s cubic-bezier(.2,1.15,.3,1),width .42s cubic-bezier(.2,1.35,.3,1),height .42s cubic-bezier(.2,1.35,.3,1),border-radius .42s cubic-bezier(.2,1.35,.3,1),transform .36s cubic-bezier(.2,1.15,.3,1),border-color .2s; }
.qr-motion-edge { position:absolute; height:5px; background:#ffd45c; opacity:0; transition:left .36s,top .36s,width .36s,transform .36s,opacity .18s; }
.qr-motion[data-state="verifying"][data-has-target="true"] .qr-motion-shape { opacity:0; }
.qr-motion[data-state="verifying"][data-has-target="true"] .qr-motion-edge { opacity:1; }
.qr-motion-finder { position:absolute; display:grid; place-items:center; color:#e5eef5; transition:left .34s cubic-bezier(.15,1.4,.3,1),top .34s cubic-bezier(.15,1.4,.3,1),width .34s,height .34s,opacity .16s; }
.qr-motion-finder svg { width:100%; height:100%; }
.qr-motion-finder::after { content:''; position:absolute; width:35%; height:35%; background:#202b36; }
.qr-motion-check { position:absolute; width:58px; height:58px; color:#51e8a7; filter:drop-shadow(0 1px 3px #14212b) drop-shadow(0 0 2px #14212b); opacity:0; transform:scale(.5); transition:left .3s,top .3s,opacity .2s,transform .35s cubic-bezier(.2,1.45,.3,1); }
.qr-motion[data-state="verifying"] .qr-motion-shape { border-color:#ffd45c; }
.qr-motion[data-state="verified"] .qr-motion-shape { border-color:#51e8a7; border-width:6px; }
.qr-motion[data-state="verified"] .qr-motion-finder { opacity:0; color:#51e8a7; }
.qr-motion[data-state="verified"] .qr-motion-check { opacity:1; transform:scale(1); transition-delay:.18s; }
.qr-motion[data-state="rejected"] .qr-motion-shape { border-color:#ffb4b4; }
@media (prefers-reduced-motion:reduce) { .qr-motion-shape,.qr-motion-edge,.qr-motion-finder,.qr-motion-check { transition:none!important; } }
`;
