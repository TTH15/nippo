// ============================================================
// 通知に載せる「アプリを開く」リンクの基点 URL。
//
// 通知はドライバーの端末（LINE アプリ内ブラウザ）で開かれるため、
// プレビュー環境の URL ではなく常に本番の URL を指す必要がある。
// 決められないときは null を返し、呼び出し側はリンクごと省く
// （壊れたリンクを送るくらいなら出さない）。
// ============================================================

/**
 * 環境変数から本番の基点 URL（末尾スラッシュ無し）を解決する。
 *   1. APP_BASE_URL … 明示指定（独自ドメイン運用時はこれ）
 *   2. VERCEL_PROJECT_PRODUCTION_URL … Vercel が本番ドメインを入れる（プロトコル無し）
 */
export function getAppBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return null;
}

/** アプリ内のパスを絶対 URL にする。基点が未設定なら null。 */
export function appUrl(path: string): string | null {
  const base = getAppBaseUrl();
  if (!base) return null;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
