import { describe, expect, it } from "vitest";
import { workCaptureSteps } from "../src/capture/steps";
import { advanceCapture, canSubmitCapture, newCaptureDraft } from "../ui-preview/capture-model";

describe("開始・終了の撮影順と確定条件", () => {
  it("開始時のメーターを残し、退勤時は点検写真で終える", () => {
    expect(workCaptureSteps("in", true)).toEqual(["qr", "safety", "inspection", "meter"]);
    expect(workCaptureSteps("out", true)).toEqual(["qr", "inspection"]);
    expect(workCaptureSteps("out", false)).toEqual(["qr"]);
  });
  it.each([true, false])("車両撮影の要否=%sでもQRだけでは確定できず、メーターは必須", required => {
    let draft = newCaptureDraft("in", required);
    draft = advanceCapture(draft);
    expect(canSubmitCapture(draft)).toBe(false);
    while (draft.plan[draft.index] !== "meter") draft = advanceCapture(draft);
    expect(canSubmitCapture(draft)).toBe(false);
    draft = advanceCapture(draft);
    expect(canSubmitCapture(draft)).toBe(true);
    expect(canSubmitCapture({ ...draft, completed: draft.completed.filter(s => s !== "meter") })).toBe(false);
  });
  it("必須の車両写真が欠けた確認状態は確定しない", () => {
    let draft = newCaptureDraft("out", true);
    while (draft.plan[draft.index] !== "review") draft = advanceCapture(draft);
    expect(canSubmitCapture({ ...draft, completed: draft.completed.filter(s => s !== "rear") })).toBe(false);
  });
});

it("終了後のメーターは駐車記録へ分離し、日報を待たせない", () => {
  let draft = newCaptureDraft("out", false);
  expect(draft.plan).toEqual(["qr", "review"]);
  draft = advanceCapture(draft);
  expect(canSubmitCapture(draft)).toBe(true);
});
