/**
 * ドライバーの表示名を返す。display_name が未設定の場合は苗字のみ（名前の先頭2文字）をデフォルトとする。
 */
export function getDisplayName(d: {
  name: string;
  display_name?: string | null;
}): string {
  const trimmed = (d.display_name ?? "").trim();
  if (trimmed) return trimmed;
  const name = (d.name ?? "").trim();
  if (!name) return "";
  // 苗字のみ: スペースがあれば前半、なければ先頭2文字（一般的な日本語の姓）
  if (name.includes(" ")) return name.split(/\s/)[0] ?? name;
  return name.slice(0, 2);
}
