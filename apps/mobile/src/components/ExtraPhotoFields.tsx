import { View, Text, Pressable, ActivityIndicator } from "react-native";
import type { PhotoCaptureTask } from "@repo/core/logic/photoCapturePolicy";
import { AppIcon } from "./AppIcon";

export function ExtraPhotoFields({ tasks, captured, busy, onCapture }: {
  tasks: PhotoCaptureTask[];
  captured: Record<string, boolean>;
  busy: boolean;
  onCapture: (task: PhotoCaptureTask) => void;
}) {
  if (!tasks.length) return null;
  return <View className="gap-2">
    {tasks.map(task => <Pressable key={task.id} accessibilityRole="button" disabled={busy} onPress={() => onCapture(task)}
      className="min-h-14 flex-row items-center gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3 active:opacity-80">
      {busy ? <ActivityIndicator size="small" /> : <AppIcon name={captured[task.id] ? "circle-check" : "camera"} size={17} color={captured[task.id] ? "#287958" : "#454c56"} iconStyle="solid" />}
      <Text className="flex-1 text-[14px] font-medium text-brand-900">{task.label}</Text>
      <Text className="text-[12px] text-brand-500">{captured[task.id] ? "撮影済み" : task.required ? "必須" : "任意"}</Text>
    </Pressable>)}
  </View>;
}
