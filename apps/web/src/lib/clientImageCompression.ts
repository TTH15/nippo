export type ImageDimensions = { width: number; height: number };

export function fitImageWithin(
  width: number,
  height: number,
  maxDimension: number,
): ImageDimensions {
  if (width <= 0 || height <= 0 || maxDimension <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadBrowserImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    image.src = url;
  });
}

/**
 * 写真をJSON APIのbody上限へ十分収まるJPEG data URLにする。
 * 長辺と品質を段階的に下げ、Base64化後の文字数でも上限を確認する。
 */
export async function compressImageFileToDataUrl(
  file: File,
  options?: { maxDimension?: number; quality?: number; maxDataUrlChars?: number },
): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("画像ファイルを選択してください");

  const image = await loadBrowserImage(file);
  const initialMaxDimension = options?.maxDimension ?? 1600;
  const initialQuality = options?.quality ?? 0.82;
  const maxDataUrlChars = options?.maxDataUrlChars ?? 1_800_000;
  let dataUrl = "";

  for (let attempt = 0; attempt < 6; attempt++) {
    const maxDimension = Math.max(720, Math.round(initialMaxDimension * 0.82 ** attempt));
    const quality = Math.max(0.55, initialQuality - attempt * 0.06);
    const size = fitImageWithin(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像処理を開始できませんでした");
    // PNG等の透明部分がJPEG化で黒くならないよう白で埋める。
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= maxDataUrlChars) return dataUrl;
  }

  if (!dataUrl || dataUrl.length > maxDataUrlChars) {
    throw new Error("画像を保存可能なサイズまで縮小できませんでした");
  }
  return dataUrl;
}
