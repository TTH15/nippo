import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationArrow } from "@fortawesome/free-solid-svg-icons";

export function ParkingRecenterButton({ onClick }: { onClick: () => void }) {
  return <button type="button" aria-label="現在地に戻る" title="現在地に戻る" onClick={onClick}
    className="absolute left-3 top-3 flex min-h-11 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold text-slate-900 shadow">
    <FontAwesomeIcon icon={faLocationArrow} aria-hidden="true" />現在地
  </button>;
}
