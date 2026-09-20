// ============================================================
// 日報の原本画像（スクショ・写真）の受け取り。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2 原本提出・保存基盤）
//
// ここが守ること:
//   - 受け取ったバイト列をそのまま保存する（再圧縮・回転・切り抜きをしない）
//   - 4つの日時を混同しない（受領 / 画像の作成 / ファイルの更新 / 対象の営業日）
//   - 取れなかった作成日時を現在時刻で埋めない（「不明」のまま受け付ける）
//   - ハッシュは「受領後に同じファイルか」の照合だけに使う
//   - 同じ原本の再送は同じ提出として扱い、二重日報・二重集計を作らない
//   - 別日・別人への流用らしさは「要確認」にするだけで、提出を拒否しない
// ============================================================
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyFileContent } from "@/server/storage/fileSignature";
import { readCapturedAt } from "./imageMetadata";

/** 原本として受け取る形式。PDFは原本になり得るが、まず画像から始める */
export const SOURCE_IMAGE_MIME = ["image/jpeg", "image/png"];
/** 1枚の上限。スクショ・写真の実寸に合わせる */
export const SOURCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** exif=画像内メタデータ / photo_library=写真ライブラリ / unknown=取得できなかった */
export type CapturedAtSource = "exif" | "photo_library" | "unknown";

export type SourceImageSubmission = {
  reportDate: string;
  courseId: string | null;
  clientKey: string;
  originalFilename: string | null;
  capturedAt: string | null;
  capturedAtSource: CapturedAtSource;
  fileModifiedAt: string | null;
  width: number | null;
  height: number | null;
};

export type SourceImageParseResult =
  | { ok: true; value: SourceImageSubmission }
  | { ok: false; error: string };

const isDateOnly = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/** 受領時刻より未来、または極端に古い時刻は取り違えとして落とす */
function parseTimestamp(value: unknown, now: Date): { ok: true; value: string | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, value: null };
  const time = new Date(String(value)).getTime();
  if (Number.isNaN(time)) return { ok: false };
  if (time > now.getTime() + 5 * 60_000) return { ok: false };
  // 2000年より前のスクショは実務上あり得ない（端末時計の初期化などの取り違え）
  if (time < Date.UTC(2000, 0, 1)) return { ok: false };
  return { ok: true, value: new Date(time).toISOString() };
}

/**
 * 提出のメタデータを検証する。画像そのものの検査（中身のMIME）は saveSourceImage 側で行う。
 */
export function parseSourceImageSubmission(raw: unknown, ctx: { now?: Date } = {}): SourceImageParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "提出の内容を確認してください" };
  const body = raw as Record<string, unknown>;
  const now = ctx.now ?? new Date();

  if (!isDateOnly(body.reportDate)) return { ok: false, error: "対象日が不正です" };
  if (typeof body.clientKey !== "string" || body.clientKey.length === 0 || body.clientKey.length > 64) {
    return { ok: false, error: "送信の識別子が不正です" };
  }
  const courseId = typeof body.courseId === "string" && body.courseId ? body.courseId : null;

  const filenameRaw = typeof body.originalFilename === "string" ? body.originalFilename.trim() : "";
  if (filenameRaw.length > 200) return { ok: false, error: "ファイル名が長すぎます" };
  // 保存パスはサーバーが決める。元ファイル名は記録だけで、パスに使わない
  const originalFilename = filenameRaw ? filenameRaw.replace(/[\\/]/g, "_") : null;

  const source = body.capturedAtSource;
  if (source != null && source !== "exif" && source !== "photo_library" && source !== "unknown") {
    return { ok: false, error: "画像の日時の取得元が不正です" };
  }
  const captured = parseTimestamp(body.capturedAt, now);
  if (!captured.ok) return { ok: false, error: "画像の作成日時が不正です" };
  const modified = parseTimestamp(body.fileModifiedAt, now);
  if (!modified.ok) return { ok: false, error: "ファイルの更新日時が不正です" };

  // 取得元が無い作成日時は「不明」に落とす。出どころのない日時を記録として残さない
  const capturedAtSource: CapturedAtSource =
    captured.value && source && source !== "unknown" ? (source as CapturedAtSource) : "unknown";
  const capturedAt = capturedAtSource === "unknown" ? null : captured.value;

  const size = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000 ? value : null;

  return {
    ok: true,
    value: {
      reportDate: body.reportDate,
      courseId,
      clientKey: body.clientKey,
      originalFilename,
      capturedAt,
      capturedAtSource,
      fileModifiedAt: modified.value,
      width: size(body.width),
      height: size(body.height),
    },
  };
}

/**
 * none=初めての原本 / same_submission=同じ提出の再送（行を増やさない）
 * same_image=同じ画像を別の提出として出した / other_date・other_driver=別日・別人への流用
 */
export type DuplicateFlag = "none" | "same_submission" | "same_image" | "other_date" | "other_driver";

export type ExistingSourceImage = {
  id: string;
  driverId: string;
  reportDate: string;
  clientKey: string;
};

/**
 * 同じ中身の原本が既にあるかを見る。拒否の判断ではなく、確認の要否を決める。
 * 同じ提出の再送（同じ人・同じ日・同じ client_key）は元の提出として扱う。
 */
export function classifyDuplicate(
  existing: readonly ExistingSourceImage[],
  incoming: { driverId: string; reportDate: string; clientKey: string },
): { flag: DuplicateFlag; sameSubmissionId: string | null } {
  const same = existing.find(
    (row) => row.driverId === incoming.driverId && row.clientKey === incoming.clientKey,
  );
  if (same) return { flag: "same_submission", sameSubmissionId: same.id };
  if (existing.some((row) => row.driverId !== incoming.driverId)) return { flag: "other_driver", sameSubmissionId: null };
  if (existing.some((row) => row.reportDate !== incoming.reportDate)) return { flag: "other_date", sameSubmissionId: null };
  // 同じ人・同じ日に同じ画像をもう1枚出した。行は作るが、確認の対象として印を付ける
  return { flag: existing.length > 0 ? "same_image" : "none", sameSubmissionId: null };
}

export const SOURCE_IMAGE_BUCKET = "report-source-images";

export type SaveSourceImageResult = {
  id: string;
  sha256: string;
  status: string;
  duplicate: DuplicateFlag;
  /** 同じ提出の再送だったか（新しい行を作っていない） */
  reused: boolean;
  /** 保存した作成日時と、その取得元。取れなければ null / "unknown" */
  capturedAt: string | null;
  capturedAtSource: CapturedAtSource;
};

/**
 * 原本を非公開バケットへ置き、記録を残す。
 * 失敗は例外にして呼び出し側で扱う（日報の保存とは独立させる）。
 */
export async function saveSourceImage(
  db: SupabaseClient,
  bytes: Uint8Array,
  input: SourceImageSubmission,
  ctx: { orgId: string; driverId: string; declaredMime: string },
): Promise<SaveSourceImageResult> {
  if (bytes.byteLength === 0) throw new Error("画像が空です");
  if (bytes.byteLength > SOURCE_IMAGE_MAX_BYTES) {
    throw new Error(`画像は${Math.floor(SOURCE_IMAGE_MAX_BYTES / (1024 * 1024))}MBまでです`);
  }
  // 申告された形式ではなく中身で判定する
  const verified = verifyFileContent(bytes, SOURCE_IMAGE_MIME, ctx.declaredMime);
  if (!verified.ok) throw new Error("対応していない画像形式です（JPEG / PNG）");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // 作成日時はファイルの中身から読む。端末の申告より確かで、取れなければ「不明」のまま。
  // スクショは日時を持たないことが多い（LINE経由などで落ちる）ので、無いことを異常としない
  const fromFile = readCapturedAt(bytes);
  const capturedAt = fromFile.capturedAt ?? input.capturedAt;
  const capturedAtSource: CapturedAtSource = fromFile.capturedAt
    ? "exif"
    : input.capturedAt
      ? input.capturedAtSource
      : "unknown";

  const { data: existingRows, error: existingError } = await db
    .from("report_source_images")
    .select("id, driver_id, report_date, client_key")
    .eq("org_id", ctx.orgId)
    .eq("sha256", sha256)
    // 同じ画像が大量にあっても「別人の流用」を取りこぼさないよう、順序を固定して読む
    .order("received_at", { ascending: true })
    .order("id")
    .limit(200);
  if (existingError) throw new Error("提出済みの原本を確認できませんでした");
  const existing: ExistingSourceImage[] = (existingRows ?? []).map((row) => ({
    id: row.id as string,
    driverId: row.driver_id as string,
    reportDate: row.report_date as string,
    clientKey: row.client_key as string,
  }));
  const duplicate = classifyDuplicate(existing, {
    driverId: ctx.driverId,
    reportDate: input.reportDate,
    clientKey: input.clientKey,
  });
  // 同じ提出の再送。原本を増やさず、既にある行をそのまま返す
  if (duplicate.sameSubmissionId) {
    return {
      id: duplicate.sameSubmissionId,
      sha256,
      status: "received",
      duplicate: "same_submission",
      reused: true,
      capturedAt,
      capturedAtSource,
    };
  }

  // 同じ提出枠（client_key）で中身の違う画像を出し直した＝訂正。
  // 原本を差し替えず、別の行として足して前の提出を指す（一意制約にも当てない）
  const { data: sameKeyRow, error: sameKeyError } = await db
    .from("report_source_images")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("driver_id", ctx.driverId)
    .eq("client_key", input.clientKey)
    .maybeSingle();
  if (sameKeyError) throw new Error("提出済みの原本を確認できませんでした");
  const supersedesId = (sameKeyRow?.id as string | undefined) ?? null;
  const clientKey = supersedesId ? `${input.clientKey.slice(0, 54)}:${sha256.slice(0, 8)}` : input.clientKey;

  const extension = ctx.declaredMime === "image/png" ? "png" : "jpg";
  const storagePath = `${ctx.orgId}/${ctx.driverId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await db.storage.from(SOURCE_IMAGE_BUCKET).upload(storagePath, bytes, {
    contentType: ctx.declaredMime,
    upsert: false,
  });
  if (uploadError) {
    console.error("[report source image] upload error", uploadError);
    throw new Error("原本を保存できませんでした");
  }

  const row = {
    org_id: ctx.orgId,
    driver_id: ctx.driverId,
    report_date: input.reportDate,
    course_id: input.courseId,
    storage_path: storagePath,
    sha256,
    byte_size: bytes.byteLength,
    mime: ctx.declaredMime,
    width: input.width,
    height: input.height,
    original_filename: input.originalFilename,
    captured_at: capturedAt,
    captured_at_source: capturedAtSource,
    file_modified_at: input.fileModifiedAt,
    // 読み取りは別の処理。原本を受け取った時点では「提出済み・件数確認待ち」
    status: "received",
    client_key: clientKey,
    supersedes_id: supersedesId,
  };
  // tenant-scope-ok: org_id は認証済みの所属、driver_id は本人に固定
  const { data, error } = await db.from("report_source_images").insert(row).select("id").single();
  if (error || !data) {
    // 行を作れなかった原本は残さない（参照のないファイルを溜めない）
    await db.storage.from(SOURCE_IMAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    console.error("[report source image] insert error", error);
    throw new Error("原本を保存できませんでした");
  }
  return {
    id: data.id as string,
    sha256,
    status: "received",
    duplicate: duplicate.flag,
    reused: false,
    capturedAt,
    capturedAtSource,
  };
}
