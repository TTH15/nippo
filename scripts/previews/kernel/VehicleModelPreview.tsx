// 3Dモデル（Mapbox/three）はプレビューでは読み込まない。枠だけ残す。
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCar } from "@fortawesome/free-solid-svg-icons";

export function VehicleModelPreview({ className }: { className?: string; modelKey?: string; bodyColor?: string | null }) {
  return (
    <div className={`${className ?? ""} flex items-center justify-center text-slate-300`}>
      <FontAwesomeIcon icon={faCar} className="h-12 w-12" />
    </div>
  );
}
