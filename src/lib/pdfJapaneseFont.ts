// jsPDF 用の日本語フォント登録ヘルパー。
//   public/fonts の Sawarabi Gothic (SIL OFL) を実行時に fetch → base64 → addFont。
//   フォントは丸ごと埋め込まれる（jsPDF はサブセット非対応）ため、PDF は font 分だけ重くなる。
//   常用＋人名の多くをカバーするが、稀な人名漢字（﨑・髙 等）は字形が無い場合がある。
import type { jsPDF } from "jspdf";

const FONT_URL = "/fonts/SawarabiGothic-Regular.ttf";
const FONT_VFS = "SawarabiGothic-Regular.ttf";
export const JP_FONT_NAME = "SawarabiGothic";

let cachedBase64: string | null = null;

async function loadFontBase64(): Promise<string> {
  if (cachedBase64) return cachedBase64;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error("日本語フォントの読み込みに失敗しました");
  const bytes = new Uint8Array(await res.arrayBuffer());
  // ArrayBuffer → base64（大きいので 0x8000 バイトずつ btoa）。
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  cachedBase64 = btoa(binary);
  return cachedBase64;
}

/** jsPDF インスタンスに日本語フォントを登録し、フォント名を返す。 */
export async function registerJapaneseFont(pdf: jsPDF): Promise<string> {
  const b64 = await loadFontBase64();
  pdf.addFileToVFS(FONT_VFS, b64);
  pdf.addFont(FONT_VFS, JP_FONT_NAME, "normal");
  return JP_FONT_NAME;
}
