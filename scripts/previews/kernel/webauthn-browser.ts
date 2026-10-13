// 隔離runner専用。OSのPasskey登録・生体認証は呼び出さない。
export async function startRegistration(_options: { optionsJSON: unknown }) {
  return { id: "preview-only-credential", type: "public-key", response: {} };
}

export async function startAuthentication(_options: { optionsJSON: unknown }) {
  if ((_options.optionsJSON as { previewCancel?: boolean })?.previewCancel) throw Object.assign(new Error("Preview cancelled"), { name: "NotAllowedError" });
  return { id: "preview-only-credential", type: "public-key", response: {} };
}
