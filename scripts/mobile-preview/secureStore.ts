const values = new Map<string, string>();
const failFirstSave = new URLSearchParams(location.search).get("scenario") === "storage-error";
let failed = false;

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (failFirstSave && !failed) {
    failed = true;
    throw new Error("Preview device storage error");
  }
  values.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  values.delete(key);
}

export async function getItemAsync(key: string): Promise<string | null> {
  return values.get(key) ?? null;
}
