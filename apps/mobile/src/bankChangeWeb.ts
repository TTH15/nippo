import { Linking } from "react-native";
import { BANK_CHANGE_PATH } from "@repo/core/logic/bankChange";
export function bankChangeWebUrl(base = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://hakotora.jp") {
  const origin = new URL(base);
  if (origin.protocol !== "https:" && !(typeof __DEV__ !== "undefined" && __DEV__ && origin.protocol === "http:")) throw new Error("Web接続先を確認してください");
  // アプリの認証情報をURLへ渡さず、ブラウザで通常ログインする。
  return new URL(BANK_CHANGE_PATH, origin.origin).toString();
}
export const openBankChangeWeb = () => Linking.openURL(bankChangeWebUrl());
