/** 保存エラーの生の本文には入力内容が含まれ得るため、既知の原因だけを案内する。 */
export function sharedMemoError(cause: unknown, operation: "read" | "save"): string {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "Forbidden" || message === "HTTP 403") {
    return operation === "save"
      ? "共有メモを編集する権限がありません。運営に編集権限を確認してください。"
      : "共有メモを閲覧する権限がありません。運営に閲覧権限を確認してください。";
  }
  if (message === "Unauthorized" || message === "HTTP 401" || message.includes("ログインし直してください") || message === "運営画面にはかんたんログインが必要です") {
    return "運営画面にログインし直してください。";
  }
  if (message === "共有メモの内容を確認してください" || message === "HTTP 400") {
    return "変更内容を保存できませんでした。入力した内容を確認してください。";
  }
  if (message === "同じ箇所を他の人が更新しました。最新の内容を確認してください" || message === "HTTP 409") {
    return "同じ箇所に別の変更があります。最新の内容を確認してください。";
  }
  if (message === "共有メモを保存できませんでした" || message === "共有メモを読み込めませんでした" || /^HTTP 5\d\d$/.test(message)) {
    return operation === "save" ? "サーバーで共有メモを保存できませんでした。少し待って再試行してください。"
      : "サーバーから共有メモを読み込めませんでした。少し待って再試行してください。";
  }
  if (message === "権限を確認できませんでした。時間をおいてもう一度お試しください") {
    return "権限を確認できませんでした。少し待って再試行してください。";
  }
  if (navigator.onLine === false) return "オフラインです。接続が戻ったら同期してください。";
  if (/^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i.test(message)) {
    return "サーバーと通信できませんでした。接続を確認してください。";
  }
  return operation === "save" ? "保存結果を確認できませんでした。もう一度同期してください。"
    : "共有メモの最新の内容を確認できませんでした。もう一度同期してください。";
}

export function personalMemoSaveError(cause: unknown): string {
  const name = cause instanceof Error || cause instanceof DOMException ? cause.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return "ブラウザの保存容量が足りません。空き容量を確認してください。";
  }
  if (name === "SecurityError" || name === "NotAllowedError") {
    return "このブラウザでは保存が許可されていません。サイトの保存設定を確認してください。";
  }
  return "この端末に個人メモを保存できませんでした。もう一度保存してください。";
}
