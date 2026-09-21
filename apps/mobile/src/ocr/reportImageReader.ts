import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import TextRecognition, { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";
import {
  anchorTextMatches,
  applyRefinements,
  chooseTemplate,
  completeRead,
  estimateSkewAngle,
  locateFields,
  predictMissingAnchors,
  readAreas,
  type AreaRefinement,
  type Box,
  type FieldArea,
  type ImageTemplate,
  type OcrPage,
  type OcrWord,
  type ReadResult,
} from "@repo/core/logic/reportImageTemplate";

// ============================================================
// 日報の原本画像を端末内で読む（モバイル）。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-3 / RIMG-5）
//
// 画像は端末から出ない。読み取りの段取りは Web と同じで、
// 判定・抽出は @repo/core の純粋関数を共有する（エンジンだけ ML Kit）。
//   1段目: 画面全体を読んで見出しを探し、様式を判定して「値があるはずの枠」を決める
//   2段目: その枠だけを切り出し、数字として読み直す
//
// ★ML Kit は確度を返さない。Web（tesseract）の確度で弾いていた分を、
//   「切り出しから数字が1つだけ素直に取れたか」「縁に文字が掛かっていないか」で代える。
//   迷ったら read ではなく uncertain にして、本人の確認へ回す。
// ============================================================

export type Rotation = 0 | 90 | 180 | 270;

export type PreparedImage = { uri: string; width: number; height: number; rotate: Rotation; angle: number };

/** 1段目に渡す画像の長辺。小さいと細い数字を落とす */
const PASS1_LONG_SIDE = 2400;
/** 2段目で欄を切り出すときの目標の高さ */
const CROP_TARGET_HEIGHT = 140;
const CROP_MAX_SCALE = 6;
const CROP_PADDING_RATIO = 0.08;

/**
 * 指定の角度だけ回した画像を作る（原本は書き換えない・端末のキャッシュに別ファイルを作る）。
 * 角度は90度単位に限らない（写真で撮った画面の傾きを直すため）。
 * ※ダークテーマの反転は行わない。ML Kit は白抜き文字もそのまま読めるため（Webの tesseract は反転が要る）。
 */
export async function loadUpright(uri: string, rotate: Rotation, angle: number = rotate): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  if (angle !== 0) context.rotate(angle);
  const rendered = await context.renderAsync();
  const scale = Math.min(1, PASS1_LONG_SIDE / Math.max(rendered.width, rendered.height));
  const sized =
    scale < 1
      ? await ImageManipulator.manipulate(rendered)
          .resize({ width: Math.round(rendered.width * scale) })
          .renderAsync()
      : rendered;
  const saved = await sized.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
  return { uri: saved.uri, width: saved.width, height: saved.height, rotate, angle };
}

/** 1段目。画面全体を読んで語と座標を得る */
export async function readPage(prepared: PreparedImage): Promise<OcrPage> {
  const result = await TextRecognition.recognize(prepared.uri, TextRecognitionScript.JAPANESE);
  const words: OcrWord[] = [];
  for (const block of result.blocks ?? []) {
    for (const line of block.lines ?? []) {
      for (const element of line.elements ?? []) {
        const frame = element.frame;
        if (!frame) continue;
        words.push({ text: element.text, x: frame.left, y: frame.top, w: frame.width, h: frame.height });
      }
    }
  }
  return { width: prepared.width, height: prepared.height, words };
}

/** 数字が1つだけ素直に取れたか。ML Kit は確度を返さないので、これを確からしさの代わりにする */
function readingConfidence(text: string, clipped: boolean): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const clean = tokens.length === 1 && /^[0-9,]+$/.test(tokens[0]);
  if (clipped) return 0.3;
  return clean ? 0.9 : 0.45;
}

export type RefineOutcome = { refinements: AreaRefinement[]; crops: Record<string, string> };

/** 2段目。枠だけを切り出して読み直す */
export async function refineAreas(prepared: PreparedImage, areas: readonly FieldArea[]): Promise<RefineOutcome> {
  const refinements: AreaRefinement[] = [];
  const crops: Record<string, string> = {};
  for (const area of areas) {
    if (!area.box) continue;
    const box = area.box;
    const inset = Math.max(2, Math.round(Math.min(box.w, box.h) * CROP_PADDING_RATIO));
    const originX = Math.max(0, Math.round(box.x + inset));
    const originY = Math.max(0, Math.round(box.y + inset));
    const width = Math.min(prepared.width - originX, Math.round(box.w - inset * 2));
    const height = Math.min(prepared.height - originY, Math.round(box.h - inset * 2));
    if (width <= 4 || height <= 4) continue;

    const factor = Math.max(1, Math.min(CROP_MAX_SCALE, CROP_TARGET_HEIGHT / height));
    const rendered = await ImageManipulator.manipulate(prepared.uri)
      .crop({ originX, originY, width, height })
      .resize({ width: Math.round(width * factor) })
      .renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
    crops[area.fieldId] = saved.uri;

    const result = await TextRecognition.recognize(saved.uri, TextRecognitionScript.LATIN);
    // 切り出しの縁に文字が掛かっていたら、隣の欄を巻き込んだ疑いがある
    const edge = Math.max(2, saved.width * 0.02);
    const clipped = (result.blocks ?? []).some((block) =>
      (block.lines ?? []).some((line) => {
        const frame = line.frame;
        if (!frame) return false;
        return (
          frame.left < edge ||
          frame.top < edge ||
          frame.left + frame.width > saved.width - edge ||
          frame.top + frame.height > saved.height - edge
        );
      }),
    );
    const text = (result.text ?? "").trim();
    refinements.push({ fieldId: area.fieldId, text, confidence: readingConfidence(text, clipped), clipped });
  }
  return { refinements, crops };
}

/**
 * 1段目で見つからなかった見出しを、あるはずの場所を切り出して探し直す（Web と同じ手）。
 * 行見出しが崩れると位置合わせも行の押さえも効かなくなるので、見つけたら語として足す。
 */
async function recoverAnchors(prepared: PreparedImage, page: OcrPage, template: ImageTemplate): Promise<OcrPage> {
  const missing = predictMissingAnchors(page, template).slice(0, 6);
  if (missing.length === 0) return page;
  const added: OcrWord[] = [];
  for (const { spec, box } of missing) {
    const originX = Math.max(0, Math.round(box.x));
    const originY = Math.max(0, Math.round(box.y));
    const width = Math.min(prepared.width - originX, Math.round(box.w));
    const height = Math.min(prepared.height - originY, Math.round(box.h));
    if (width <= 8 || height <= 8) continue;
    const factor = Math.max(1, Math.min(CROP_MAX_SCALE, 120 / height));
    const rendered = await ImageManipulator.manipulate(prepared.uri)
      .crop({ originX, originY, width, height })
      .resize({ width: Math.round(width * factor) })
      .renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
    const result = await TextRecognition.recognize(saved.uri, TextRecognitionScript.JAPANESE);
    const text = (result.text ?? "").replace(/\s+/g, "");
    if (!anchorTextMatches(spec, text)) continue;
    const sample = spec.sampleBox as Box;
    added.push({
      text: spec.text,
      x: box.x + (box.w - sample.w) / 2,
      y: box.y + (box.h - sample.h) / 2,
      w: sample.w,
      h: sample.h,
    });
  }
  return added.length > 0 ? { ...page, words: [...page.words, ...added] } : page;
}

export type ReportImageOutcome = {
  template: ImageTemplate | null;
  rotation: Rotation;
  result: ReadResult | null;
  crops: Record<string, string>;
  prepared: PreparedImage;
  attempts: { rotate: Rotation; score: number }[];
};

const rotationsFor = (templates: readonly ImageTemplate[]): Rotation[] => {
  const hints = templates
    .map((template) => template.definition.orientation?.rotate)
    .filter((value): value is Rotation => value === 0 || value === 90 || value === 180 || value === 270);
  return Array.from(new Set<Rotation>([...hints, 0, 90, 270, 180]));
};

/**
 * 1枚を読む。様式の向きヒントから順に試す。
 * どの様式にも当てはまらなければ template=null（手入力のまま進める）。
 */
export async function readReportImage(
  uri: string,
  templates: readonly ImageTemplate[],
  options: { reportDate?: string | null; onStep?: (step: string) => void } = {},
): Promise<ReportImageOutcome> {
  const attempts: { rotate: Rotation; score: number }[] = [];
  let best: { prepared: PreparedImage; page: OcrPage; template: ImageTemplate; score: number } | null = null;

  for (const rotate of rotationsFor(templates)) {
    options.onStep?.("画像を読んでいます");
    let prepared = await loadUpright(uri, rotate);
    let page = await readPage(prepared);
    // 写真で撮った画面は数度傾く。傾いたままだと行の左の見出しと右の数字が食い違う
    const skew = estimateSkewAngle(page);
    if (skew !== 0) {
      prepared = await loadUpright(uri, rotate, rotate - skew);
      page = await readPage(prepared);
    }
    const choice = chooseTemplate(page, templates);
    const score = choice.ranked[0]?.score ?? 0;
    attempts.push({ rotate, score });
    const matched = choice.best ? (templates.find((t) => t.key === choice.best?.templateKey) ?? null) : null;
    if (matched && (!best || score > best.score)) best = { prepared, page, template: matched, score };
    // 様式に当てはまった時点で止める（4方向すべて読むと実機で数倍待たされる）
    if (choice.best) break;
  }

  if (!best) {
    const prepared = await loadUpright(uri, 0);
    return { template: null, rotation: 0, result: null, crops: {}, prepared, attempts };
  }

  options.onStep?.("件数を読み取っています");
  const page = await recoverAnchors(best.prepared, best.page, best.template);
  const located = locateFields(page, best.template);
  const first = readAreas(page, best.template, located, { reportDate: options.reportDate });
  const { refinements, crops } = await refineAreas(best.prepared, located.areas);
  const refined = applyRefinements(best.template, first, refinements, { reportDate: options.reportDate });
  const result = completeRead(best.template, located.match, refined);

  return { template: best.template, rotation: best.prepared.rotate, result, crops, prepared: best.prepared, attempts };
}

export type { Box };
