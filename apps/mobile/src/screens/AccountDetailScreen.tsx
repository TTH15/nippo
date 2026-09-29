import { useState } from "react";
import { Alert } from "react-native";
import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import { MeScreen } from "./MeScreen";
import type { AccountSection } from "../components/MyPageMenu";

export function AccountDetailScreen({ route, navigation }: {
  route: { params: { section: AccountSection } };
  navigation: { dispatch: (action: NavigationAction) => void };
}) {
  const [dirty, setDirty] = useState(false);
  usePreventRemove(dirty, ({ data }) => Alert.alert("変更を破棄しますか？", "振込口座の変更はまだ保存されていません。", [
    { text: "編集を続ける", style: "cancel" },
    { text: "破棄して戻る", style: "destructive", onPress: () => navigation.dispatch(data.action) },
  ]));
  return <MeScreen section={route.params.section} onUnsavedChange={setDirty} />;
}
