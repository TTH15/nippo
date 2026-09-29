import { AppIcon } from "../src/components/AppIcon";
import { Text, View } from "react-native";

export function CourseLabel({ name }: { name: string }) {
  return <View accessible accessibilityRole="text" accessibilityLabel={`コース、${name}`} style={{ alignSelf: "flex-start", maxWidth: "100%", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <AppIcon name="route" size={18} color="#526074" iconStyle="solid" />
    <Text numberOfLines={1} style={{ color: "#526074", fontSize: 15, fontWeight: "600" }}>{name}</Text>
  </View>;
}
