import { configureAuth } from "@repo/core/auth";
import { configureApi } from "@repo/core/api";
import { secureStoreStorage, hydrateAuthStorage } from "./auth/secureStoreStorage";

// ============================================================
// アプリ起動時に共有 core（@repo/core）へプラットフォーム依存を注入する。
//   - 認証ストレージ: SecureStore（メモリ hydrate 済の同期アダプタ）
//   - 401 遷移: 呼び出し側のコールバック（ログイン画面へ戻す）
//   - API ベースURL: 絶対オリジン（EXPO_PUBLIC_API_BASE_URL）
// ============================================================

export async function bootstrap(onUnauthorized: () => void): Promise<void> {
  await hydrateAuthStorage();
  configureAuth({ storage: secureStoreStorage, onUnauthorized });
  configureApi({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "" });
}
