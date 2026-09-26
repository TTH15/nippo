export type PhotoCaptureStage = "start" | "end" | "parking";
export type PhotoCaptureTask = {
  id: string;
  label: string;
  stage: PhotoCaptureStage;
  required: boolean;
};

export const PHOTO_CAPTURE_STAGES: ReadonlyArray<{ value: PhotoCaptureStage; label: string }> = [
  { value: "start", label: "稼働開始" },
  { value: "end", label: "業務終了" },
  { value: "parking", label: "駐車" },
];

export const PHOTO_CAPTURE_PRESETS = [
  "オイル交換シール",
  "鍵を置いた場所",
  "給油口のキャップ",
  "駐車場所と周囲",
] as const;

export function parsePhotoCaptureTasks(value: unknown): PhotoCaptureTask[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const ids = new Set<string>();
  const tasks: PhotoCaptureTask[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!/^[a-z0-9-]{1,50}$/.test(id) || ids.has(id) || !label || label.length > 40 ||
      !["start", "end", "parking"].includes(String(row.stage)) || typeof row.required !== "boolean") return null;
    ids.add(id);
    tasks.push({ id, label, stage: row.stage as PhotoCaptureStage, required: row.required });
  }
  return tasks;
}
