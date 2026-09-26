import { supabase } from "@/server/db/client";
import { INSPECTION_BUCKET } from "./inspectionStorage";
import { isStoredPathInScope } from "@/server/storage/scope";
import { parsePhotoCaptureTasks, type PhotoCaptureStage, type PhotoCaptureTask } from "@repo/core/logic/photoCapturePolicy";

export async function loadPhotoCaptureTasks(orgId: string): Promise<PhotoCaptureTask[] | null> {
  const { data, error } = await supabase.from("organizations").select("photo_capture_tasks").eq("id", orgId).maybeSingle();
  if (error || !data) return null;
  return parsePhotoCaptureTasks(data.photo_capture_tasks);
}

export async function validateStagePhotos(input: {
  orgId: string;
  driverId: string;
  stage: PhotoCaptureStage;
  photos: Array<{ angle: string; path: string }>;
  tasks: PhotoCaptureTask[];
}): Promise<string | null> {
  const stageTasks = input.tasks.filter(task => task.stage === input.stage);
  const allowed = new Set(stageTasks.map(task => `extra:${task.id}`));
  const found = new Set(input.photos.map(photo => photo.angle));
  if (input.photos.length > 24 || found.size !== input.photos.length ||
    input.photos.some(photo => photo.angle.startsWith("extra:") && !allowed.has(photo.angle))) {
    return "撮影項目を確認してください";
  }
  const missing = stageTasks.find(task => task.required && !found.has(`extra:${task.id}`));
  if (missing) return `「${missing.label}」を撮影してください`;
  if (input.photos.some(photo => !isStoredPathInScope(photo.path, `${input.orgId}/${input.driverId}`))) {
    return "写真を確認できませんでした";
  }
  const checks = await Promise.all(input.photos.map(photo => supabase.storage.from(INSPECTION_BUCKET).info(photo.path)));
  if (checks.some(check => check.error || !check.data)) return "写真を確認できませんでした。もう一度送信してください";
  return null;
}
