// safe-area-context 5.x で className の型が落ちたための「拡張」（上書きではない＝import が必要）。
// ランタイムは react-native-css-interop の third-party 登録で className 対応済み。
import "react-native-safe-area-context";

declare module "react-native-safe-area-context" {
  interface NativeSafeAreaViewProps {
    className?: string;
  }
}
