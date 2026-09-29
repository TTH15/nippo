import { Image, Text, View } from "react-native";
import type { VehiclePlateData } from "@repo/core/types";
import { plateGlyphs } from "./plate-assets/glyphs";
import layout from "./plate-assets/layout.json";

const schemes: Record<string, string[]> = { black: ["#000000", "#e8d44d", "#b8a038"], yellow: ["#f2c50f", "#151515", "#a8880a"], white: ["#f4f5f1", "#17603e", "#9aa0a6"], green: ["#0a5a40", "#ffffff", "#d5d9de"] };
const chars = (text: string) => [...text];

/** Web正本のSVG字形・配置を使用。未登録の地名/かなは文字で補い、架空番号を埋めない。 */
export function VehiclePlate({ vehicle, width = 168 }: { vehicle: VehiclePlateData; width?: number }) {
  const [bg, color, frame] = schemes[vehicle.plate_color ?? "black"] ?? schemes.black;
  const scale = width / layout.referenceWidth;
  const region = vehicle.number_prefix || "", classification = vehicle.number_class || "", kana = vehicle.number_hiragana || "";
  const digits = (vehicle.number_numeric || "").replace(/\D/g, "").slice(0, 4);
  if (!region && !classification && !kana && !digits) return <Text style={{ fontSize: 14, color: "#526074" }}>ナンバー未登録</Text>;
  const serial = digits.padStart(4, "・");
  const sequence = [serial[0], serial[1], digits.length === 4 ? "-" : "", serial[2], serial[3]];
  const glyphWidth = (category: string, char: string, height: number) => height * (category === "serial" ? plateGlyphs[category]?.[char]?.relativeWidth ?? .6 : plateGlyphs[category]?.[char]?.ratio ?? .8);
  const render = (category: string, char: string, x: number, y: number, height: number, key: string) => {
    if (!char) return null;
    const g = plateGlyphs[category]?.[char], w = glyphWidth(category, char, height);
    return g ? <Image key={key} source={g.source} accessible={false} resizeMode="contain" style={{ position: "absolute", left: x * scale, top: (y + (category === "serial" ? height * g.yOffset : 0)) * scale, width: w * scale, height: height * (category === "serial" ? g.relativeHeight : 1) * scale, tintColor: color }} />
      : <Text key={key} style={{ position: "absolute", left: x * scale, top: y * scale, width: w * scale, height: height * scale * 1.3, fontSize: height * scale, lineHeight: height * scale * 1.1, color, textAlign: "center" }}>{char}</Text>;
  };
  const top = layout.top, bottom = layout.bottom;
  const classSlot = Math.max(...chars("0123456789").map(c => glyphWidth("classification", c, top.glyphHeight)));
  const regionWidth = chars(region).reduce((w, c) => w + glyphWidth("kanji", c, top.glyphHeight), 0) + top.regionGap * Math.max(0, region.length - 1);
  const topWidth = regionWidth + (region && classification ? top.groupGap : 0) + classification.length * classSlot + Math.max(0, classification.length - 1) * top.classificationGap;
  let x = (layout.referenceWidth - topWidth) / 2;
  const row = chars(region).map((c, i) => { const node = render("kanji", c, x, top.top, top.glyphHeight, `region:${i}`); x += glyphWidth("kanji", c, top.glyphHeight) + top.regionGap; return node; });
  x = (layout.referenceWidth - topWidth) / 2 + regionWidth + (region && classification ? top.groupGap : 0);
  for (const [i, c] of chars(classification).entries()) { row.push(render("classification", c, x + (classSlot - glyphWidth("classification", c, top.glyphHeight)) / 2, top.top, top.glyphHeight, `class:${i}`)); x += classSlot + top.classificationGap; }
  const slot = Math.max(...chars("0123456789").map(c => glyphWidth("serial", c, bottom.serialHeight)));
  const widths = sequence.map((c, i) => i === 2 ? glyphWidth("serial", "-", bottom.serialHeight) : slot);
  const kanaWidth = glyphWidth("hiragana", kana, bottom.kanaHeight);
  const total = kanaWidth + bottom.kanaGap + widths.reduce((a, b) => a + b, 0) + bottom.serialGap * 4;
  x = (layout.referenceWidth - total) / 2;
  const baseline = layout.referenceHeight - bottom.bottom;
  row.push(render("hiragana", kana, x, baseline - bottom.serialHeight / 2 - bottom.kanaHeight / 2, bottom.kanaHeight, "kana")); x += kanaWidth + bottom.kanaGap;
  for (const [i, c] of sequence.entries()) { row.push(render("serial", c, x + (widths[i] - glyphWidth("serial", c, bottom.serialHeight)) / 2, baseline - bottom.serialHeight, bottom.serialHeight, `serial:${i}`)); x += widths[i] + bottom.serialGap; }
  return <View accessible accessibilityRole="image" accessibilityLabel={[region, classification, kana, vehicle.number_numeric].filter(Boolean).join(" ")} style={{ position: "relative", width, height: width / 2, backgroundColor: bg, borderRadius: layout.cornerRadius * scale, borderWidth: 1.5, borderColor: frame, overflow: "hidden" }}>{row}</View>;
}

export function VehicleIdentity({ vehicle, light = false, width = 168 }: { vehicle: VehiclePlateData; light?: boolean; width?: number }) {
  return <View style={{ alignItems: "center", gap: 8 }}><VehiclePlate vehicle={vehicle} width={width} />
    {!!(vehicle.brand || vehicle.manufacturer) && <Text style={{ color: light ? "#DEE6F0" : "#526074", fontSize: 13 }}>{[vehicle.manufacturer, vehicle.brand].filter(Boolean).join(" ")}</Text>}
  </View>;
}
