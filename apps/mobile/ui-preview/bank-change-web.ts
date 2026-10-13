import { Alert } from "react-native";
export async function openBankChangeWeb() {
  Alert.alert("Webで口座を変更", "画面確認モードです。ブラウザの口座変更プレビューで操作を確認してください。");
}
