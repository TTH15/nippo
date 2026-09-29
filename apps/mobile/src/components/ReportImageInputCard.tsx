import type { ReactNode } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { AppIcon } from "./AppIcon";

export function ReportImageInputCard({ busy = false, label, onPress, children }: {
  busy?: boolean; label: string; onPress: () => void; children?: ReactNode;
}) {
  return <View className="gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
    <Text className="text-base font-semibold text-brand-900">配完表・実績の画像</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={onPress}
      className="min-h-14 flex-row gap-3 items-center justify-center rounded-xl bg-brand-900 px-4 py-3">
      {busy ? <ActivityIndicator color="white" /> : <AppIcon name="images" size={20} color="white" />}
      <Text className="text-base font-semibold text-white">{label}</Text>
    </Pressable>
    {children}
  </View>;
}
