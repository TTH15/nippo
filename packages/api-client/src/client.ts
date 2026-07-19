// API クライアント(プラットフォーム非依存)。
// fetch / Blob は Web・RN 双方に存在するため本体は共有できる。
// 唯一の差分はベースURL: Web は相対パス(同一オリジン)、RN は絶対 URL が
// 必要なため configureApi({ baseUrl }) で注入する。
// 認証トークンと 401 遷移はアプリの auth ストアから注入を受ける。

export interface ApiClient {
  /** API のベースURLを設定する(RN 起動時に絶対オリジンを注入)。 */
  configureApi(opts: { baseUrl?: string }): void;
  /** 設定中のベースURLを取得(テスト・デバッグ用)。 */
  getApiBaseUrl(): string;
  /**
   * 認証付き fetch ラッパ。
   * - Bearer トークンを自動付与(注入された getToken)。
   * - 401 は onUnauthorized()(保存値破棄+ログイン遷移)を発火し throw。
   * - text/csv は Blob、それ以外は JSON を返す。
   * - path が "http" 始まりなら baseUrl を付けずそのまま使う。
   */
  apiFetch<T = unknown>(
    path: string,
    options?: RequestInit,
    opts?: { skipAuthRedirect?: boolean }
  ): Promise<T>;
}

export function createApiClient(deps: {
  getToken: () => string | null;
  onUnauthorized: () => void;
}): ApiClient {
  // 既定は空文字=相対パス(Web の従来挙動)。RN は起動時に絶対URLを注入する。
  let baseUrl = "";

  return {
    configureApi(opts) {
      if (opts.baseUrl !== undefined) baseUrl = opts.baseUrl;
    },
    getApiBaseUrl() {
      return baseUrl;
    },
    async apiFetch<T = unknown>(
      path: string,
      options: RequestInit = {},
      opts: { skipAuthRedirect?: boolean } = {}
    ): Promise<T> {
      const token = deps.getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((options.headers as Record<string, string>) ?? {}),
      };

      const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
      const res = await fetch(url, { ...options, headers });

      if (res.status === 401) {
        // ログイン等、401 が「資格情報の誤り」を意味する呼び出しはリダイレクトせず
        // サーバのエラー文言を投げて呼び出し側で表示させる(保存値破棄/遷移はしない)。
        if (opts.skipAuthRedirect) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Unauthorized");
        }
        deps.onUnauthorized();
        throw new Error("Unauthorized");
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      // Handle CSV or non-JSON
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/csv")) {
        return (await res.blob()) as unknown as T;
      }

      return res.json();
    },
  };
}
