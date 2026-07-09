import { View, Text } from "react-native";
import type { VehiclePlateData } from "@repo/core/types";

// カレンダーセル用の簡易ナンバープレート表示。
// Web版 VehiclePlate（コンテナクエリ・専用フォント）はRNに移植できないため、
// システムフォントでの縮小版として作成。

export function VehiclePlateMini({ vehicle }: { vehicle: VehiclePlateData }) {
  const hasPlate = vehicle.number_prefix || vehicle.number_hiragana || vehicle.number_numeric;

  if (!hasPlate) {
    return (
      <View className="bg-brand-100 rounded px-1 py-0.5 items-center justify-center">
        <Text className="text-brand-500 text-[8px]" numberOfLines={1}>
          {[vehicle.manufacturer, vehicle.brand].filter(Boolean).join(" ") || "車両"}
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-black rounded px-1 py-0.5 border border-[#b8a038]">
      <View className="flex-row items-baseline justify-center gap-0.5">
        <Text className="text-[#e8d44d] text-[7px] font-medium" numberOfLines={1}>
          {vehicle.number_prefix || "京都"}
        </Text>
        <Text className="text-[#e8d44d] text-[7px]" numberOfLines={1}>
          {vehicle.number_class || "400"}
        </Text>
      </View>
      <View className="flex-row items-center justify-center gap-0.5">
        <Text className="text-[#e8d44d] text-[9px] font-bold" numberOfLines={1}>
          {vehicle.number_hiragana || "わ"}
        </Text>
        <Text className="text-[#e8d44d] text-[11px] font-black tracking-wide" numberOfLines={1}>
          {formatPlateNumeric(vehicle.number_numeric || "")}
        </Text>
      </View>
    </View>
  );
}

function formatPlateNumeric(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const arr = Array(4).fill("・");
  for (let i = 0; i < digits.length; i++) arr[4 - digits.length + i] = digits[i];
  const sep = digits.length === 4 ? "-" : " ";
  return `${arr[0]}${arr[1]}${sep}${arr[2]}${arr[3]}`;
}
