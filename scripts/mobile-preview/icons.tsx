import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation, faUser, faSliders, faShieldHalved, faBuildingColumns, faXmark, faCircleCheck, faFileLines, faChevronRight, faGauge, faCamera, faLocationDot, faImages, faCheck, faFaceSmile, faFingerprint, faBraille, faLock, faSquareParking, faHandshake, faTruckFast, faQrcode } from "@fortawesome/free-solid-svg-icons";
const icons = { "triangle-exclamation": faTriangleExclamation, user: faUser, sliders: faSliders, "shield-halved": faShieldHalved, "building-columns": faBuildingColumns, xmark: faXmark, "circle-check": faCircleCheck, "file-lines": faFileLines, "chevron-right": faChevronRight, gauge: faGauge, camera: faCamera, "location-dot": faLocationDot, images: faImages, check: faCheck, "face-smile": faFaceSmile, fingerprint: faFingerprint, braille: faBraille, lock: faLock, "square-parking": faSquareParking, handshake: faHandshake, "truck-fast": faTruckFast, qrcode: faQrcode };
export function FontAwesome6({ name, size, color }: { name: keyof typeof icons; size: number; color: string }) {
  return <FontAwesomeIcon icon={icons[name]} style={{ width: size, height: size, color }} />;
}
