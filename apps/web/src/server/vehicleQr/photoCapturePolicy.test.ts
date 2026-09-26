import { describe, expect, it } from "vitest";
import { parsePhotoCaptureTasks } from "@repo/core/logic/photoCapturePolicy";
import { parseInspectionPhotos } from "./inspectionPolicy";

describe("会社別の撮影項目", () => {
  it("開始・終了・駐車の追加写真を受け取る", () => {
    const tasks = parsePhotoCaptureTasks([
      { id: "oil-sticker", label: "オイル交換シール", stage: "parking", required: true },
      { id: "fuel-cap", label: "給油口のキャップ", stage: "end", required: false },
    ]);
    expect(tasks?.map(task => task.stage)).toEqual(["parking", "end"]);
    expect(parseInspectionPhotos([{ angle: "extra:oil-sticker", path: "org/driver/photo.jpg" }])).toHaveLength(1);
  });

  it("同じID、長すぎる名前、未知の段階と不正な写真キーを拒む", () => {
    const item = { id: "key-place", label: "鍵を置いた場所", stage: "parking", required: true };
    expect(parsePhotoCaptureTasks([item, item])).toBeNull();
    expect(parsePhotoCaptureTasks([{ ...item, label: "あ".repeat(41) }])).toBeNull();
    expect(parsePhotoCaptureTasks([{ ...item, stage: "anytime" }])).toBeNull();
    expect(parseInspectionPhotos([{ angle: "extra:../other", path: "file.jpg" }])).toHaveLength(0);
  });
});
