// ============================================================
// 日報の原本画像を端末内OCR（tesseract.js）で読んだ結果を、手元で確かめる開発用スクリプト。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-1 / RIMG-3）
//
//   npx tsx scripts/report-image/try-read.ts <画像パス> [--template <様式JSON>] [--rotate 0,90,180,270]
//
// 実物の配完表はリポジトリへ置かない。引数でローカルのファイルを渡して測る。
// Web と同じ言語データ（apps/web/public/ocr/lang）を使い、本番と同じ条件で測る。
// ============================================================
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import {
  applyRefinements,
  estimateSkewAngle,
  buildLines,
  chooseTemplate,
  completeRead,
  locateFields,
  medianWordHeight,
  readAreas,
  type AreaRefinement,
  type Box,
  type ImageTemplate,
  type OcrPage,
  type OcrWord,
} from "@repo/core/logic/reportImageTemplate";

const LANG_PATH = path.resolve("apps/web/public/ocr/lang");
/** OCRに渡す最大辺。小さすぎると細い数字を落とし、大きすぎると遅くなる */
const MAX_SIDE = Number(process.env.OCR_MAX_SIDE ?? 4000);
/**
 * 端末の画面サイズが違っても文字の大きさを揃える。
 * 小さいスクショは拡大し、大きいスクショはそのまま渡す（OCRは文字の絶対サイズに敏感）。
 */
const TARGET_LONG_SIDE = Number(process.env.OCR_TARGET ?? 3000);
/** raw=無加工 / gray=グレー化 / sharp=グレー化＋輪郭強調 / bw=二値化 */
const PRE = process.env.OCR_PRE ?? "bw";
const DUMP = process.env.OCR_DUMP ?? "";
/** 2段目で枠を切り出すときの拡大率 */
const CROP_SCALE = Number(process.env.OCR_CROP_SCALE ?? 6);

type Prepared = { buffer: Buffer; width: number; height: number; scale: number; upright: Buffer };

async function toCanvasBuffer(file: Buffer, rotate: number): Promise<Prepared> {
  // rotate は度。90度単位に限らず、写真の傾きを直すための小さな角度も受け取る
  // EXIF の向きを先に確定させてから回す（rotate を重ねると後の指定で上書きされる）
  let upright = await sharp(file).rotate().toBuffer();
  // 暗い画面（ダークテーマのスクショ）は画像ごと反転して以降を白背景に揃える。
  // 1段目だけ反転して2段目（欄の切り出し）を元のままにすると、切り出しだけ読めなくなる
  const pageStats = await sharp(upright).stats();
  const pageMean = pageStats.channels.slice(0, 3).reduce((acc, c) => acc + c.mean, 0) / 3;
  if (pageMean < 110) upright = await sharp(upright).negate({ alpha: false }).toBuffer();
  const turned = rotate === 0 ? upright : await sharp(upright).rotate(rotate, { background: "#ffffff" }).toBuffer();
  const meta = await sharp(turned).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const longest = Math.max(width, height);
  const scale = Math.max(1, Math.min(TARGET_LONG_SIDE / longest, MAX_SIDE / longest, 4));
  let pipeline = sharp(turned).resize({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    kernel: "lanczos3",
  });
  if (PRE === "gray") pipeline = pipeline.grayscale();
  if (PRE === "sharp") pipeline = pipeline.grayscale().sharpen();
  if (PRE === "bw") pipeline = pipeline.grayscale().threshold(185);
  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
  // 語の座標は「回転だけした原寸」に戻す。様式の座標系を拡大率から切り離すため
  return { buffer: data, width, height, scale: info.width / width, upright: turned };
}

async function recognize(worker: Worker, prepared: Prepared): Promise<OcrPage> {
  const result = await worker.recognize(prepared.buffer, {}, { blocks: true });
  const s = prepared.scale || 1;
  const words: OcrWord[] =
    result.data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) =>
          line.words.map((word) => ({
            text: word.text,
            x: word.bbox.x0 / s,
            y: word.bbox.y0 / s,
            w: (word.bbox.x1 - word.bbox.x0) / s,
            h: (word.bbox.y1 - word.bbox.y0) / s,
            confidence: word.confidence / 100,
          })),
        ),
      ),
    ) ?? [];
  return { width: prepared.width, height: prepared.height, words };
}

/** 枠の外側を少し落として切り出し、拡大してから数字として読む */
async function readCrop(worker: Worker, upright: Buffer, box: Box, dumpTo: string | null = null): Promise<{ text: string; confidence: number; clipped: boolean }> {
  const meta = await sharp(upright).metadata();
  const inset = Math.max(2, Math.round(Math.min(box.w, box.h) * 0.08));
  const left = Math.max(0, Math.round(box.x + inset));
  const top = Math.max(0, Math.round(box.y + inset));
  const width = Math.min((meta.width ?? 0) - left, Math.round(box.w - inset * 2));
  const height = Math.min((meta.height ?? 0) - top, Math.round(box.h - inset * 2));
  if (width <= 4 || height <= 4) return { text: "", confidence: 0, clipped: false };
  // 切り出した欄の文字が十分大きくなるまで拡大し、周りに余白を足す
  // （枠いっぱいの小さな数字は、余白が無いとOCRが桁を取り違える）
  const factor = Math.max(1, Math.min(CROP_SCALE, 140 / Math.max(1, height)));
  const buffer = await sharp(upright)
    .extract({ left, top, width, height })
    .resize({ width: Math.round(width * factor), kernel: "lanczos3" })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: "#ffffff" })
    .png()
    .toBuffer();
  if (dumpTo) await (await import("node:fs/promises")).writeFile(dumpTo, buffer);
  const { data } = await worker.recognize(buffer, {}, { blocks: true });
  const meta2 = await sharp(buffer).metadata();
  const words = data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) ?? [];
  // 切り出しの縁に文字が掛かっていたら隣の欄を巻き込んだ疑い
  const clipped = words.some(
    (word) =>
      word.bbox.x0 < 12 ||
      word.bbox.x1 > (meta2.width ?? 0) - 12 ||
      word.bbox.y0 < 12 ||
      word.bbox.y1 > (meta2.height ?? 0) - 12,
  );
  return { text: (data.text ?? "").trim(), confidence: (data.confidence ?? 0) / 100, clipped };
}

async function main() {
  const [imagePath, ...rest] = process.argv.slice(2);
  if (!imagePath) {
    console.error("使い方: npx tsx scripts/report-image/try-read.ts <画像パス> [--template <様式JSON>]");
    process.exit(1);
  }
  const templateArg = rest.includes("--template") ? rest[rest.indexOf("--template") + 1] : null;
  const rotateArg = rest.includes("--rotate") ? rest[rest.indexOf("--rotate") + 1] : "0,90,180,270";
  const quiet = rest.includes("--quiet");
  // 表は行のまとまりが取れないので、既定は疎なテキストとして読む（実測でこれが最良）
  const psmArg = rest.includes("--psm") ? rest[rest.indexOf("--psm") + 1] : "11";
  const rotations = rotateArg.split(",").map((v) => Number(v.trim()));
  // 見本として登録し直す（様式JSONの sample を今回の読み取りで置き換える）
  const updateSample = rest.includes("--update-sample");

  const file = await readFile(imagePath);
  const template: ImageTemplate | null = templateArg
    ? (JSON.parse(await readFile(templateArg, "utf8")) as ImageTemplate)
    : null;
  // プリセットは報告項目が未束縛。手元で動かすためだけに仮の束縛を入れる
  if (template) {
    for (const field of template.definition.fields ?? []) {
      if (!field.unitId) field.unitId = `dry-${field.id}`;
      if (!field.fieldKey) field.fieldKey = field.id;
    }
  }

  const worker = await createWorker(["jpn", "eng"], 1, {
    langPath: LANG_PATH,
    gzip: false,
    cachePath: path.join(tmpdir(), "hakotora-ocr-cache"),
  });
  if (psmArg) await worker.setParameters({ tessedit_pageseg_mode: psmArg as PSM });
  // 2段目は数字だけを読む。日本語辞書を混ぜると数字を漢字に寄せてしまう
  const digitWorker = await createWorker(["eng"], 1, {
    langPath: LANG_PATH,
    gzip: false,
    cachePath: path.join(tmpdir(), "hakotora-ocr-cache"),
  });
  await digitWorker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, user_defined_dpi: "300" });

  try {
    for (const rotate of rotations) {
      const started = Date.now();
      let prepared = await toCanvasBuffer(file, rotate);
      let page = await recognize(worker, prepared);
      // 写真で撮った画面は数度傾く。傾いたままだと行の左の見出しと右の数字が食い違う
      const firstSkew = estimateSkewAngle(page);
      if (firstSkew !== 0) {
        prepared = await toCanvasBuffer(file, rotate - firstSkew);
        page = await recognize(worker, prepared);
      }
      const { width, height } = prepared;
      if (DUMP) await (await import("node:fs/promises")).writeFile(`${DUMP}-${rotate}.png`, prepared.buffer);
      const elapsed = Date.now() - started;
      const skew = estimateSkewAngle(page);
      const lines = buildLines(page.words);
      const numbers = page.words.filter((w) => /^\d+$/.test(w.text.trim()));
      console.log(
        `\n==== 回転 ${rotate}° / ${width}x${height} / ${elapsed}ms / 語 ${page.words.length}（数字 ${numbers.length}）/ 文字高 ${medianWordHeight(page.words).toFixed(1)} / 傾き ${firstSkew.toFixed(2)}→${skew.toFixed(2)}° ====`,
      );
      if (!quiet) console.log(lines.slice(0, 40).map((l) => `  [${Math.round(l.box.y)}] ${l.words.map((w) => w.text).join(" ")}`).join("\n"));
      if (process.env.OCR_WORDS === "1") {
        for (const word of page.words) {
          console.log(`    w "${word.text}" x=${Math.round(word.x)} y=${Math.round(word.y)} w=${Math.round(word.w)} h=${Math.round(word.h)}`);
        }
      }

      if (template && updateSample) {
        const { writeFile } = await import("node:fs/promises");
        const raw = JSON.parse(await readFile(templateArg as string, "utf8"));
        raw.definition.sample = {
          width,
          height,
          unitHeight: Number(medianWordHeight(page.words).toFixed(1)),
          words: page.words
            .filter((word) => word.text.trim().length >= 2)
            .map((word) => ({
              text: word.text,
              box: { x: Math.round(word.x), y: Math.round(word.y), w: Math.round(word.w), h: Math.round(word.h) },
            })),
        };
        await writeFile(templateArg as string, `${JSON.stringify(raw, null, 2)}\n`);
        console.log(`  見本を更新しました（語 ${raw.definition.sample.words.length}）`);
        continue;
      }

      if (template) {
        const choice = chooseTemplate(page, [template]);
        const best = choice.ranked[0];
        console.log(`  様式一致: ${(best.score * 100).toFixed(0)}% / 採用=${best.accepted} / 欠け=[${best.missingRequired.join(", ")}]`);

        // 1段目: 見出しから「値があるはずの枠」を決め、そこに入っている語で読む
        const locateStarted = Date.now();
        const located = locateFields(page, template);
        if (process.env.OCR_DEBUG === "1") {
          const t = located.transform;
          console.log(`  位置合わせ: x*${t.scaleX.toFixed(3)}+${t.dx.toFixed(1)} / y*${t.scaleY.toFixed(3)}+${t.dy.toFixed(1)}`);
          for (const area of located.areas) {
            if (area.box) console.log(`    枠 ${area.fieldId}: x=${Math.round(area.box.x)} y=${Math.round(area.box.y)} w=${Math.round(area.box.w)} h=${Math.round(area.box.h)}`);
          }
        }
        const first = readAreas(page, template, located);
        // 2段目: 枠だけを切り出して読み直す（表の数字はこちらが確実）
        const refinements: AreaRefinement[] = [];
        for (const area of located.areas) {
          if (!area.box) continue;
          const field = template.definition.fields.find((f) => f.id === area.fieldId);
          if (!field) continue;
          const text = await readCrop(digitWorker, prepared.upright, area.box, process.env.OCR_DEBUG === "1" ? `${DUMP || "/tmp/claude-501/crop"}-${area.fieldId}.png` : null);
          refinements.push(text);
        }
        const refineMs = Date.now() - locateStarted;
        const refined = applyRefinements(template, first, refinements.map((r, i) => ({ ...r, fieldId: located.areas.filter((a) => a.box)[i].fieldId })));
        const result = completeRead(template, located.match, refined);
        for (const field of result.fields) {
          console.log(
            `   - ${field.label}: ${field.value ?? "—"} (${field.status}${field.refined ? "・切出" : ""}, 確度${(field.confidence * 100).toFixed(0)}%)`,
          );
        }
        console.log(`  時間: 1段目 ${elapsed}ms / 2段目 ${refineMs}ms（${located.areas.filter((a) => a.box).length}欄）/ 合計 ${elapsed + refineMs}ms`);
        console.log(
          `  機械の答え合わせ: ${result.trust.level}（式 ${result.trust.checksRun}本・不一致 ${result.trust.checksFailed}本）` +
            (result.trust.reasons.length ? ` / ${result.trust.reasons.join(" / ")}` : ""),
        );
        if (result.warnings.length) console.log(`   ! ${result.warnings.join(" / ")}`);
      }
    }
  } finally {
    await worker.terminate();
    await digitWorker.terminate();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
