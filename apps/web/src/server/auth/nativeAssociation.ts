// 信頼する証明書はサーバー設定だけから読む。リクエストのorigin/platformは使わない。
export function androidSigningFingerprints(): string[] {
  const value = process.env.PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS?.trim();
  if (!value) return [];
  return [...new Set(value.split(",").map((entry) => {
    const fingerprint = entry.trim().toUpperCase();
    if (!/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)) {
      throw new Error("Invalid PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS");
    }
    return fingerprint;
  }))];
}

export function nativeAndroidOrigins(): string[] {
  return androidSigningFingerprints().map((fingerprint) =>
    `android:apk-key-hash:${Buffer.from(fingerprint.replaceAll(":", ""), "hex").toString("base64url")}`);
}

export function appleAppIds(): string[] {
  const value = process.env.PASSKEY_APPLE_APP_ID?.trim();
  if (!value) return [];
  // App ID prefix は必ずAppleの配布プロファイルで確認する。
  if (!/^[A-Z0-9]{10}\.jp\.hakotora\.app$/.test(value)) throw new Error("Invalid PASSKEY_APPLE_APP_ID");
  return [value];
}
