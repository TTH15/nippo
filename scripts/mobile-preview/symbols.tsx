// ブラウザ隔離プレビューはiOSのネイティブ描画を読み込まず、Font Awesomeで形を確認する。
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faBell, faBellSlash, faRoute, faChevronDown, faChevronLeft, faChevronRight, faChevronUp, faCheck, faCircleCheck, faCrosshairs, faLocationDot, faCalendarDays, faUser, faYenSign, faCarSide, faCamera, faBolt, faLock, faTriangleExclamation, faFileLines, faTrash, faImage, faImages, faPhone, faGift, faCircle, faSliders, faSquareParking, faHandshake, faTruckFast, faXmark, faShieldHalved, faBuildingColumns, faFaceSmile, faFingerprint, faBraille, faMobileScreenButton, faRotateRight, faHandPointer, faIdCard, faUserShield } from "@fortawesome/free-solid-svg-icons";

const icons = {
  "line.3.horizontal": faBars, bell: faBell, "bell.slash": faBellSlash,
  "point.topleft.down.curvedto.point.bottomright.up": faRoute,
  "chevron.down": faChevronDown, "chevron.left": faChevronLeft, "chevron.right": faChevronRight, "chevron.up": faChevronUp,
  checkmark: faCheck, "checkmark.circle.fill": faCircleCheck, scope: faCrosshairs, mappin: faLocationDot,
  calendar: faCalendarDays, person: faUser, "person.crop.circle": faUser, yensign: faYenSign, "car.side": faCarSide,
  camera: faCamera, "camera.rotate": faCamera, "bolt.fill": faBolt, "lock.fill": faLock,
  "exclamationmark.triangle": faTriangleExclamation, "doc.text": faFileLines, trash: faTrash,
  photo: faImage, "photo.on.rectangle": faImages, phone: faPhone, gift: faGift, circle: faCircle,
  "slider.horizontal.3": faSliders, "parkingsign.circle": faSquareParking, "hands.clap": faHandshake,
  "box.truck": faTruckFast, xmark: faXmark,
  "shield.lefthalf.filled": faShieldHalved, "building.columns": faBuildingColumns,
  "face.smiling": faFaceSmile, touchid: faFingerprint, "circle.grid.3x3": faBraille,
  iphone: faMobileScreenButton, "arrow.clockwise": faRotateRight, "hand.point.up.left": faHandPointer,
  "person.text.rectangle": faIdCard, "person.crop.circle.badge.checkmark": faUserShield,
} as const;

export function SymbolView({ name, size = 20, tintColor = "#192333" }: { name: keyof typeof icons; size?: number; tintColor?: string }) {
  return <FontAwesomeIcon icon={icons[name] ?? faCircle} style={{ width: size, height: size, color: tintColor }} />;
}
