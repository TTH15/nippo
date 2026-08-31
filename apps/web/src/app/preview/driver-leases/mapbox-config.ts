// スタンドアロンの --mapbox 起動時だけ有効。本番のAPI・認証設定は参照しない。
export const PREVIEW_MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
export const PREVIEW_MAPBOX_ENABLED = process.env.NEXT_PUBLIC_PREVIEW_MAPBOX_ENABLED === "true" && PREVIEW_MAPBOX_TOKEN.startsWith("pk.");
export const previewConnectionLabel = PREVIEW_MAPBOX_ENABLED ? "Mapbox接続あり・通知送信なし" : "外部送信なし";
