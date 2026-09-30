// ログイン画面確認専用。実端末の認証ストレージには触れない。
if (!__DEV__) throw new Error("画面確認モードは開発専用です");

const values = new Map<string, string>();
let failNextSave = false;

export function failNextAuthSave(): void { failNextSave = true; }

export async function getItemAsync(key: string): Promise<string | null> {
  return values.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (failNextSave) {
    failNextSave = false;
    throw new Error("preview auth storage failure");
  }
  values.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  values.delete(key);
}
