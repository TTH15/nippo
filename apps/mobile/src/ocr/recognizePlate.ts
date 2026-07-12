import TextRecognition, { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";
import type { VehiclePlateData } from "@repo/core/types";

// ナンバープレート画像（ローカル uri）をオンデバイス OCR（ML Kit・和文）して生テキストを返す。
// QRが読めない時の退避ルート（vehicle-session-flow.md §8.5）用。画像は端末から出ない。
export async function recognizePlateText(uri: string): Promise<string> {
  const result = await TextRecognition.recognize(uri, TextRecognitionScript.JAPANESE);
  return result.text ?? "";
}

const onlyAlnumKana = (s: string): string => (s ?? "").replace(/[\s　,，、。・-]/g, "");

/**
 * OCR生テキストから、候補車両のうち一致するものを絞り込む。
 * 「ひらがな1文字」と「指定番号（数字部）」がどちらもOCRテキストに含まれるものを一致とみなす
 * （運輸支局名・分類番号までは要求しない＝誤読耐性を優先）。
 */
export function matchVehiclesByPlateText<T extends VehiclePlateData>(text: string, vehicles: T[]): T[] {
  const cleaned = onlyAlnumKana(text);
  if (!cleaned) return [];
  return vehicles.filter((v) => {
    const hira = (v.number_hiragana ?? "").trim();
    const numeric = onlyAlnumKana(v.number_numeric ?? "");
    if (!hira || !numeric) return false;
    return cleaned.includes(hira) && cleaned.includes(numeric);
  });
}
