// API クライアント（プラットフォーム非依存）のバレル。
// Web は @/lib/api 経由で apiFetch を再エクスポート（既存 import は無改変）。
// RN は起動時に configureApi({ baseUrl }) を呼んでから apiFetch を使う。
export { apiFetch, configureApi, getApiBaseUrl } from "./client";
