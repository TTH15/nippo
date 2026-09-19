import { describe, expect, it } from "vitest";
import { classifyDuplicate, parseSourceImageSubmission, type ExistingSourceImage } from "./sourceImages";

const now = new Date("2026-09-17T18:00:00+09:00");
const base = {
  reportDate: "2026-09-17",
  clientKey: "k1",
  capturedAt: "2026-09-17T17:30:00+09:00",
  capturedAtSource: "exif",
  fileModifiedAt: "2026-09-17T17:31:00+09:00",
  originalFilename: "IMG_0001.PNG",
  width: 1170,
  height: 2532,
};

describe("parseSourceImageSubmission", () => {
  it("作成日時と取得元がそろっていれば残す", () => {
    const result = parseSourceImageSubmission(base, { now });
    expect(result).toMatchObject({ ok: true, value: { capturedAtSource: "exif" } });
    if (result.ok) expect(result.value.capturedAt).toBe(new Date(base.capturedAt).toISOString());
  });

  it("取得元が不明なら作成日時を持たない（現在時刻で埋めない）", () => {
    const result = parseSourceImageSubmission({ ...base, capturedAtSource: "unknown" }, { now });
    expect(result).toMatchObject({ ok: true, value: { capturedAt: null, capturedAtSource: "unknown" } });
  });

  it("出どころのない作成日時は不明に落とす", () => {
    const result = parseSourceImageSubmission({ ...base, capturedAtSource: undefined }, { now });
    expect(result).toMatchObject({ ok: true, value: { capturedAt: null, capturedAtSource: "unknown" } });
  });

  it("ファイルの更新日時は作成日時と別に残す", () => {
    const result = parseSourceImageSubmission({ ...base, capturedAtSource: "unknown" }, { now });
    if (result.ok) expect(result.value.fileModifiedAt).toBe(new Date(base.fileModifiedAt).toISOString());
  });

  it("受領より未来・極端に古い日時は拒否", () => {
    expect(parseSourceImageSubmission({ ...base, capturedAt: "2026-09-18T09:00:00+09:00" }, { now })).toMatchObject({ ok: false });
    expect(parseSourceImageSubmission({ ...base, capturedAt: "1999-01-01T00:00:00Z" }, { now })).toMatchObject({ ok: false });
  });

  it("対象日・識別子が無ければ拒否", () => {
    expect(parseSourceImageSubmission({ ...base, reportDate: "2026/09/17" }, { now })).toMatchObject({ ok: false });
    expect(parseSourceImageSubmission({ ...base, clientKey: "" }, { now })).toMatchObject({ ok: false });
  });

  it("元ファイル名の区切り文字を落とす（保存パスに使わせない）", () => {
    const result = parseSourceImageSubmission({ ...base, originalFilename: "../../etc/passwd" }, { now });
    if (result.ok) expect(result.value.originalFilename).toBe(".._.._etc_passwd");
  });

  it("画像の対象日は日報の対象日と別。画像の日時では対象日を決めない", () => {
    // 前日のスクショを当日の日報に出しても、対象日はリクエストの reportDate のまま
    const result = parseSourceImageSubmission({ ...base, capturedAt: "2026-09-16T20:00:00+09:00" }, { now });
    expect(result).toMatchObject({ ok: true, value: { reportDate: "2026-09-17" } });
  });
});

describe("classifyDuplicate", () => {
  const row = (over: Partial<ExistingSourceImage>): ExistingSourceImage => ({
    id: "s1",
    driverId: "d1",
    reportDate: "2026-09-17",
    clientKey: "k1",
    ...over,
  });
  const incoming = { driverId: "d1", reportDate: "2026-09-17", clientKey: "k1" };

  it("初めての原本は重複なし", () => {
    expect(classifyDuplicate([], incoming)).toMatchObject({ flag: "none", sameSubmissionId: null });
  });

  it("同じ人・同じ識別子の再送は元の提出を返す", () => {
    expect(classifyDuplicate([row({})], incoming)).toMatchObject({ flag: "same_submission", sameSubmissionId: "s1" });
  });

  it("別の人が同じ原本を出したら要確認", () => {
    expect(classifyDuplicate([row({ driverId: "d2", clientKey: "k9" })], incoming)).toMatchObject({ flag: "other_driver" });
  });

  it("同じ人でも別日への流用は要確認", () => {
    expect(classifyDuplicate([row({ reportDate: "2026-09-16", clientKey: "k9" })], incoming)).toMatchObject({ flag: "other_date" });
  });

  it("同じ人・同じ日に同じ画像を別の提出として出したら same_image（行は作る）", () => {
    const result = classifyDuplicate([row({ clientKey: "k9" })], incoming);
    expect(result).toMatchObject({ flag: "same_image", sameSubmissionId: null });
  });
});
