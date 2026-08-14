import { parseLicenseExpiry } from "./parseLicenseExpiry";

// ============================================================
// 免許証写真から有効期限を読むクライアント OCR（tesseract.js・動的 import）。
// 「読めたらホイールにプリフィル、読めなければ黙って手入力のまま」の任意強化なので、
// 失敗はすべて null に落とす（UI にエラーは出さない）。
// tesseract.js の worker/wasm/言語データは初回のみ CDN から取得（数MB・遅延ロード）。
// サーバには画像を送らない＝新規外部 API・キー不要。
// ============================================================

let prefetchPromise: Promise<void> | null = null;

/**
 * tesseract.js のモジュール+言語データ（数MB・CDN）を裏で温める。
 * 免許ステップの表示中に呼んでおくと、撮影直後の初回 OCR で数MBのダウンロードを待たない
 * （従来はアップロード直後に取得が走っていた・2026-08 監査）。失敗しても本処理には影響しない。
 */
export function prefetchLicenseOcr(): void {
  if (prefetchPromise) return;
  prefetchPromise = import("tesseract.js")
    .then(async ({ createWorker }) => {
      // worker を1回起こして wasm/言語データまでブラウザキャッシュに載せ、すぐ破棄する
      const worker = await createWorker("jpn");
      await worker.terminate();
    })
    .catch(() => {
      prefetchPromise = null; // 次の機会に再試行できるようにする
    });
}

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
