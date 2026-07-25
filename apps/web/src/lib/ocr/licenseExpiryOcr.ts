import { parseLicenseExpiry } from "./parseLicenseExpiry";

// ============================================================
// 免許証写真から有効期限を読むクライアント OCR（tesseract.js・動的 import）。
// 「読めたらホイールにプリフィル、読めなければ黙って手入力のまま」の任意強化なので、
// 失敗はすべて null に落とす（UI にエラーは出さない）。
// tesseract.js の worker/wasm/言語データは初回のみ CDN から取得（数MB・遅延ロード）。
// サーバには画像を送らない＝新規外部 API・キー不要。
// ============================================================

export async function ocrLicenseExpiryFromBase64(base64Jpeg: string): Promise<string | null> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("jpn");
    try {
      const { data } = await worker.recognize(`data:image/jpeg;base64,${base64Jpeg}`);
      return parseLicenseExpiry(data.text ?? "");
    } finally {
      await worker.terminate();
    }
  } catch {
    return null;
  }
}
