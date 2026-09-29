import "../global.css";
import { SafeAreaProvider } from "react-native-safe-area-context";
import NativeHomePreview from "./NativeHomePreview";
if (!__DEV__) throw new Error("画面確認モードは開発専用です");
export default function UiPreviewApp() { return <SafeAreaProvider><NativeHomePreview /></SafeAreaProvider>; }
