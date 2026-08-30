/** 「その他」は選択肢IDやラベルに埋め込まず、自由入力を別の値として保持する。 */
export type OtherChoiceAnswer = { selected: string[]; other: string };
export type ChoiceValue = string | string[] | OtherChoiceAnswer;
export const OTHER_TEXT_MAX_LENGTH = 500;

export function isOtherChoiceAnswer(value: unknown): value is OtherChoiceAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answer = value as Partial<OtherChoiceAnswer>;
  return Array.isArray(answer.selected) && answer.selected.every(item => typeof item === "string") && typeof answer.other === "string";
}

export function choiceSelection(value: unknown): { selected: string[]; other: string | undefined } {
  if (isOtherChoiceAnswer(value)) return value;
  return { selected: Array.isArray(value) ? value.filter(item => typeof item === "string") : typeof value === "string" && value ? [value] : [], other: undefined };
}

export function validateChoiceAnswer(field: { type: "select" | "multiselect"; label: string; required: boolean; allowOther?: boolean; options?: { value: string }[] }, value: unknown): string | null {
  const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length);
  if (empty) return field.required ? `「${field.label}」を選択してください` : null;
  const invalid = `「${field.label}」の選択肢を確認してください`;
  const known = new Set(field.options?.map(option => option.value));
  if (isOtherChoiceAnswer(value)) {
    if (!field.allowOther || (field.type === "select" && value.selected.length > 0)) return invalid;
    if (new Set(value.selected).size !== value.selected.length || value.selected.some(item => !known.has(item))) return invalid;
    if (!value.other.trim()) return `「${field.label}」のその他の内容を入力してください`;
    if (value.other.length > OTHER_TEXT_MAX_LENGTH) return `「${field.label}」のその他は${OTHER_TEXT_MAX_LENGTH}文字以内で入力してください`;
    return null;
  }
  if (field.type === "select") return typeof value === "string" && known.has(value) ? null : invalid;
  return Array.isArray(value) && new Set(value).size === value.length && value.every(item => typeof item === "string" && known.has(item)) ? null : invalid;
}
