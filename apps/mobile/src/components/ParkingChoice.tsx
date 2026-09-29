import { View, Text, Pressable } from "react-native";
import { AppIcon } from "./AppIcon";
export type ParkingChoiceValue = "parked" | "handed_over" | "in_use";
export function ParkingChoice({ value, onChange }: { value: ParkingChoiceValue; onChange: (value: ParkingChoiceValue) => void }) {
  return (
        <View className="gap-2">
          <Text className="text-[13px] font-medium text-brand-700">車の置き場所</Text>
          <View className="flex-row gap-2">
            {([
              { status: "parked" as const, label: "駐車後に記録", icon: "square-parking" as const },
              { status: "handed_over" as const, label: "引き渡した", icon: "handshake" as const },
              { status: "in_use" as const, label: "まだ使う", icon: "truck-fast" as const },
            ]).map((choice) => {
              const selected = value === choice.status;
              return (
                <Pressable
                  key={choice.status}
                  className={`flex-1 min-h-11 rounded-lg border items-center justify-center gap-1 px-1 ${selected ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
                  onPress={() => onChange(choice.status)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <AppIcon name={choice.icon} size={13} color={selected ? "#ffffff" : "#454c56"} iconStyle="solid" />
                  <Text className={`text-[12px] font-medium ${selected ? "text-white" : "text-brand-700"}`} numberOfLines={1}>
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
  );
}
