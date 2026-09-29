import { useState } from "react";
import { Text, View, Pressable } from "react-native";
import { ReportImageInputCard } from "../src/components/ReportImageInputCard";
import type { ReportImageEntry } from "../src/components/ReportSourceImagePicker";
// 実画面のカードを共有。写真・解析・アップロードはすべて架空データ。
export function ReportSourceImagePicker({ onApply }: { date: string; courseId?: string | null; onApply?: (entries: ReportImageEntry[]) => void }) {
  const [result, setResult] = useState(""), [fail, setFail] = useState(false);
  return <ReportImageInputCard label="画像から入力" onPress={() => {
    if (fail) { setResult("画像を読み取れませんでした。別の画像でお試しください。"); return; }
    onApply?.([{ unitId: "preview-unit", fieldKey: "delivered", value: 84 }]);
    setResult("配達完了 84件を入力しました（架空の画像）");
  }}>
    {!!result && <Text accessibilityRole={fail ? "alert" : undefined} className="text-sm text-brand-700">{result}</Text>}
    <View><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: fail }} onPress={() => { setFail(!fail); setResult(""); }} className="min-h-11 justify-center">
      <Text className="text-xs text-brand-500">確認用：画像の読み取り失敗 {fail ? "オン" : "オフ"}</Text>
    </Pressable></View>
  </ReportImageInputCard>;
}
