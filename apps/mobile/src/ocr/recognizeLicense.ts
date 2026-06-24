import TextRecognition, { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";

// 免許画像（ローカル uri）をオンデバイス OCR（ML Kit・和文）して生テキストを返す。
// 画像は端末から出ない。失敗時は throw（呼び出し側で握って手入力フォールバック）。
export async function recognizeLicenseText(uri: string): Promise<string> {
  const result = await TextRecognition.recognize(uri, TextRecognitionScript.JAPANESE);
  return result.text ?? "";
}
