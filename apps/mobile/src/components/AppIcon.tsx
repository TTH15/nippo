import { FontAwesome6 } from "@expo/vector-icons";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Platform } from "react-native";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof FontAwesome6>["name"];
type Props = ComponentProps<typeof FontAwesome6>;

const iosSymbols: Partial<Record<IconName, SFSymbol>> = {
  bars: "line.3.horizontal",
  bell: "bell",
  "bell-slash": "bell.slash",
  bolt: "bolt.fill",
  braille: "circle.grid.3x3",
  "building-columns": "building.columns",
  "calendar-days": "calendar",
  camera: "camera",
  "camera-rotate": "camera.rotate",
  "car-side": "car.side",
  car: "car",
  "chart-line": "chart.xyaxis.line",
  check: "checkmark",
  "chevron-down": "chevron.down",
  "chevron-left": "chevron.left",
  "chevron-right": "chevron.right",
  "chevron-up": "chevron.up",
  circle: "circle",
  "circle-check": "checkmark.circle.fill",
  "clipboard-check": "checklist",
  crosshairs: "scope",
  "face-smile": "face.smiling",
  "file-invoice": "doc.text",
  "file-lines": "doc.text",
  fingerprint: "touchid",
  gift: "gift",
  "address-book": "person.crop.rectangle.stack",
  "hand-pointer": "hand.point.up.left",
  handshake: "hands.clap",
  "id-card": "person.text.rectangle",
  image: "photo",
  images: "photo.on.rectangle",
  "location-dot": "mappin",
  lock: "lock.fill",
  "mobile-screen-button": "iphone",
  phone: "phone",
  route: "point.topleft.down.curvedto.point.bottomright.up",
  "rotate-right": "arrow.clockwise",
  "shield-halved": "shield.lefthalf.filled",
  sliders: "slider.horizontal.3",
  "square-parking": "parkingsign.circle",
  trash: "trash",
  "triangle-exclamation": "exclamationmark.triangle",
  "truck-fast": "box.truck",
  truck: "box.truck",
  user: "person",
  "user-shield": "person.crop.circle.badge.checkmark",
  xmark: "xmark",
};

export function AppIcon({ name, size = 20, color = "#192333", ...rest }: Props) {
  const symbol = iosSymbols[name];
  if (Platform.OS === "ios" && symbol) return <SymbolView name={symbol} size={size} tintColor={color} fallback={<FontAwesome6 name={name} size={size} color={color} {...rest} />} />;
  return <FontAwesome6 name={name} size={size} color={color} {...rest} />;
}
