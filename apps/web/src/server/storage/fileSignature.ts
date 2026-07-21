// ============================================================
// アップロードされたファイルの「中身」を検査する（マジックバイト照合）。
//
// なぜ必要か:
//   Supabase の Restrict MIME types も、拡張子チェックも、
//   クライアントが名乗った Content-Type / ファイル名を見ているだけで、
//   偽装できる。`image/png` と称して実体は HTML/スクリプトということが起きうる。
//   署名URLでブラウザに配信する以上、中身を確認してから受け入れる。
//
// 方針:
//   - 先頭バイト列（ファイルシグネチャ）で実際の形式を判定する
//   - 申告された MIME と実体が一致しない場合は拒否する
//   - SVG は許可しない（スクリプトを埋め込める＝XSS の温床）
//   - 判定できない形式はすべて拒否（allowlist・default-deny）
//
// これは万能ではない（PDF 内の JavaScript までは見ない）が、
// 「拡張子を変えただけの実行可能ファイル」「偽装 HTML」を確実に弾ける。
// ============================================================

export type DetectedFileType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** 先頭が期待バイト列と一致するか。 */
function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/**
 * 実際のファイル形式を中身から判定する。判定できなければ null。
 * 呼び出し側は null を「受け入れない」と扱うこと。
 */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // WebP: "RIFF" .... "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  // PDF: "%PDF-"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";

  return null;
}

export type VerifyResult =
  | { ok: true; type: DetectedFileType }
  | { ok: false; message: string };

/**
 * 中身を検査し、許可リストに含まれるかを確認する。
 * declaredMime を渡した場合は、実体との一致も確認する（偽装検出）。
 */
export function verifyFileContent(
  bytes: Uint8Array,
  allowed: readonly string[],
  declaredMime?: string,
): VerifyResult {
  // 空・極端に短いファイルはシグネチャを持てない
  if (!bytes || bytes.length < 12) {
    return { ok: false, message: "ファイルが空か、内容を確認できませんでした。" };
  }

  const actual = detectFileType(bytes);
  if (!actual) {
    return {
      ok: false,
      message: "対応していないファイル形式です（PDF / JPEG / PNG のみ）。",
    };
  }

  if (!allowed.includes(actual)) {
    return {
      ok: false,
      message: "対応していないファイル形式です（PDF / JPEG / PNG のみ）。",
    };
  }

  // 申告と実体の食い違い＝偽装の可能性。JPEG の別名だけは許容する。
  if (declaredMime) {
    const normalizedDeclared = declaredMime === "image/jpg" ? "image/jpeg" : declaredMime;
    if (normalizedDeclared !== actual) {
      return {
        ok: false,
        message: "ファイルの内容が拡張子・形式と一致しません。",
      };
    }
  }

  return { ok: true, type: actual };
}
