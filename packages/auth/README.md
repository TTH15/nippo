# @platform/auth

認証トークン/ログインユーザー保管のプラットフォーム非依存ストア(出自: hakotora)。

- ストレージ実体と 401 遷移は `configureAuth()` で注入(Web: localStorage + location、RN: SecureStore + navigation)。
- ユーザー型・ストレージキーはアプリ側が `createAuthStore<TUser>({ tokenKey, userKey })` で指定する。
- Supabase Auth を使うアプリには不要(こちらは独自 JWT + Bearer 方式向け)。
