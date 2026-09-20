// ============================================================
// 日報の原本画像（配完個数表などのスクショ）を端末内で読む。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-3）
//
// 画像はサーバーへ送らない（原本の保存は別の処理）。ここは読むだけ。
// tesseract.js の worker・言語データは自サイト配信（/ocr）を使う。
//
// 二段構えで読む。実サンプル（ヤマトの配達集計精算書・2026-09-19）で測った結果、
// 全体を一度に読む方法では表の数字がほとんど取れず、欄を切り出して読むと
// 確度93〜96%でほぼ全問正解だった。
//   1段目: 画面全体を読んで見出しを探し、様式を判定して「値があるはずの枠」を決める
//   2段目: その枠だけを切り出し、数字として読み直す
//
// 画面が回って写る様式（ヤマトは縦画面に横長の表を90度回して表示する）があるので、
// 様式の向きヒントを先に試し、当たらなければ他の角度も試す。
// ============================================================
import {
  applyRefinements,
  chooseTemplate,
  completeRead,
  estimateSkewAngle,
  isReadableWord,
  locateFields,
  orientationScore,
  medianWordHeight,
  readAreas,
  type AreaRefinement,
  type Box,
  type FieldArea,
  type ImageTemplate,
  type OcrPage,
  type OcrWord,
  type ReadResult,
  type SampleWord,
} from "@repo/core/logic/reportImageTemplate";

/** 端末差をならすため、1段目は長辺をここまで拡大して読む */
const PASS1_LONG_SIDE = 3000;
const PASS1_MAX_SIDE = 4000;
/** 白黒に落とす境目。スクショは背景が白いので固定でよい */
const THRESHOLD = 185;
/** 2段目で欄を切り出すときの目標の高さ */
const CROP_TARGET_HEIGHT = 140;
const CROP_MAX_SCALE = 6;
const CROP_PADDING = 16;

export type Rotation = 0 | 90 | 180 | 270;

export type PreparedImage = {
  /** 回転（と必要なら反転）だけした原寸の画像。切り出しはここから行う */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  rotate: Rotation;
  /** 実際に回した角度。写真の傾きを直すと90度単位にならない */
  angle: number;
  /** 暗い画面だったので反転した */
  inverted: boolean;
};

type TesseractWorker = import("tesseract.js").Worker;

let pageWorker: Promise<TesseractWorker> | null = null;
let digitWorker: Promise<TesseractWorker> | null = null;

const WORKER_OPTIONS = {
  workerPath: "/ocr/runtime/tesseract/worker.min.js",
  corePath: "/ocr/runtime/tesseract",
  langPath: "/ocr/lang",
  gzip: false,
  workerBlobURL: false,
  cachePath: "hakotora-report-image-20260919",
};

/** 見出しを探す用（日本語＋英数） */
async function getPageWorker(): Promise<TesseractWorker> {
  if (!pageWorker) {
    pageWorker = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker(["jpn", "eng"], 1, WORKER_OPTIONS);
      // 表の罫線に区切られた文字を拾うため、まとまった段落を前提にしない
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "300" });
      return worker;
    })().catch((error) => {
      pageWorker = null;
      throw error;
    });
  }
  return pageWorker;
}

/** 欄を切り出して数字を読む用。日本語辞書を混ぜると数字を漢字へ寄せるので英数だけにする */
async function getDigitWorker(): Promise<TesseractWorker> {
  if (!digitWorker) {
    digitWorker = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker(["eng"], 1, WORKER_OPTIONS);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, user_defined_dpi: "300" });
      return worker;
    })().catch((error) => {
      digitWorker = null;
      throw error;
    });
  }
  return digitWorker;
}

/** 読み取りを終えたら開放する。画面を離れるときに必ず呼ぶ */
export async function releaseReaders(): Promise<void> {
  const workers = [pageWorker, digitWorker];
  pageWorker = null;
  digitWorker = null;
  await Promise.all(
    workers.map(async (pending) => {
      try {
        const worker = await pending;
        await worker?.terminate();
      } catch {
        // 解放できなくても読み取り結果には影響しない
      }
    }),
  );
}

/** 言語データ（数MB）を先に温めておく。画像を選んだ直後の待ち時間を減らす */
export function prefetchReportImageReader(): void {
  void getPageWorker().catch(() => undefined);
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** 画面が暗い（ダークテーマ）かを粗く見る。全画素は見ない */
function isDarkCanvas(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d");
  if (!context) return false;
  const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 64));
  const sample = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = sample.data;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const i = (y * canvas.width + x) * 4;
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      count += 1;
    }
  }
  return count > 0 && sum / count < 110;
}

/** 画像ごと白黒を反転する。1段目だけ反転して欄の切り出しを元のままにすると、切り出しが読めなくなる */
function invertCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  context.putImageData(image, 0, 0);
}

/**
 * 画像を指定の角度だけ回した原寸のキャンバスにする。
 * 角度は90度単位に限らない（写真で撮った画面の傾きを直すため）。
 * 暗い画面はここで反転して、以降を白背景に揃える。
 */
export async function loadUpright(
  file: Blob,
  rotate: Rotation,
  angle: number = rotate,
  options: { invert?: boolean } = {},
): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 60_000_000) throw new Error("画像が大きすぎます");
    const radians = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const canvas = makeCanvas(bitmap.width * cos + bitmap.height * sin, bitmap.width * sin + bitmap.height * cos);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を扱えませんでした");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(radians);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const inverted = options.invert !== false && isDarkCanvas(canvas);
    if (inverted) invertCanvas(canvas);
    return { canvas, width: canvas.width, height: canvas.height, rotate, angle, inverted };
  } finally {
    bitmap.close();
  }
}

/** 1段目に渡す画像。文字の大きさを端末によらず揃え、白黒に落とす */
function toPassOneCanvas(prepared: PreparedImage): { canvas: HTMLCanvasElement; scale: number } {
  const longest = Math.max(prepared.width, prepared.height);
  const scale = Math.max(1, Math.min(PASS1_LONG_SIDE / longest, PASS1_MAX_SIDE / longest, 4));
  const canvas = makeCanvas(prepared.width * scale, prepared.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return { canvas: prepared.canvas, scale: 1 };
  context.drawImage(prepared.canvas, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = gray < THRESHOLD ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return { canvas, scale };
}

/** 1段目。画面全体を読んで語と座標を得る（座標は回転後の原寸に戻す） */
export async function readPage(prepared: PreparedImage): Promise<OcrPage> {
  const { canvas, scale } = toPassOneCanvas(prepared);
  const worker = await getPageWorker();
  const result = await worker.recognize(canvas, {}, { blocks: true });
  const words: OcrWord[] =
    result.data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) =>
          line.words.map((word) => ({
            text: word.text,
            x: word.bbox.x0 / scale,
            y: word.bbox.y0 / scale,
            w: (word.bbox.x1 - word.bbox.x0) / scale,
            h: (word.bbox.y1 - word.bbox.y0) / scale,
            confidence: (word.confidence ?? 0) / 100,
          })),
        ),
      ),
    ) ?? [];
  return { width: prepared.width, height: prepared.height, words };
}

/** 枠を切り出して拡大し、周りに余白を足した画像。欄いっぱいの数字は余白が無いと桁を取り違える */
function cropCanvas(prepared: PreparedImage, box: Box): HTMLCanvasElement | null {
  const inset = Math.max(2, Math.round(Math.min(box.w, box.h) * 0.08));
  const left = Math.max(0, Math.round(box.x + inset));
  const top = Math.max(0, Math.round(box.y + inset));
  const width = Math.min(prepared.width - left, Math.round(box.w - inset * 2));
  const height = Math.min(prepared.height - top, Math.round(box.h - inset * 2));
  if (width <= 4 || height <= 4) return null;
  const factor = Math.max(1, Math.min(CROP_MAX_SCALE, CROP_TARGET_HEIGHT / height));
  const canvas = makeCanvas(width * factor + CROP_PADDING * 2, height * factor + CROP_PADDING * 2);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(prepared.canvas, left, top, width, height, CROP_PADDING, CROP_PADDING, width * factor, height * factor);
  return canvas;
}

export type RefineOutcome = {
  refinements: AreaRefinement[];
  /** 確認画面で値の横に出す、切り出した欄の画像 */
  crops: Record<string, string>;
};

/** 2段目。枠だけを切り出して読み直す */
export async function refineAreas(prepared: PreparedImage, areas: readonly FieldArea[]): Promise<RefineOutcome> {
  const worker = await getDigitWorker();
  const refinements: AreaRefinement[] = [];
  const crops: Record<string, string> = {};
  for (const area of areas) {
    if (!area.box) continue;
    const canvas = cropCanvas(prepared, area.box);
    if (!canvas) continue;
    crops[area.fieldId] = canvas.toDataURL("image/png");
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    // 切り出しの縁（足した余白）に文字が掛かっていたら、隣の欄を巻き込んだ疑いがある。
    // 数字が並ぶ表では「はっきり読めたが隣の欄の値」が一番危ないので、確度とは別に見る
    const words =
      data.blocks?.flatMap((block) =>
        block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
      ) ?? [];
    const clipped = words.some(
      (word) =>
        word.bbox.x0 < CROP_PADDING * 0.75 ||
        word.bbox.x1 > canvas.width - CROP_PADDING * 0.75 ||
        word.bbox.y0 < CROP_PADDING * 0.75 ||
        word.bbox.y1 > canvas.height - CROP_PADDING * 0.75,
    );
    refinements.push({
      fieldId: area.fieldId,
      text: (data.text ?? "").trim(),
      confidence: (data.confidence ?? 0) / 100,
      clipped,
    });
  }
  return { refinements, crops };
}

export type SampleReading = {
  rotate: Rotation;
  page: OcrPage;
  prepared: PreparedImage;
  sample: { width: number; height: number; unitHeight: number; words: SampleWord[] };
  /** 起こした向きの見本画像（反転していない）。これを見本として保存する */
  uprightBlob: Blob;
};

/**
 * 見本として登録するときの読み取り（様式の設定画面が使う）。
 * 向きは4方向を試し、**日本語・数字としてまともに読めた量**で決める
 * （語の数で決めると、横向きの誤読が語数だけ多くて勝ってしまう）。
 * rotate を渡せばその向きで固定する（管理者の手動指定）。
 */
export async function readSample(file: Blob, rotate?: Rotation): Promise<SampleReading> {
  const candidates: Rotation[] = rotate != null ? [rotate] : [0, 90, 270, 180];
  let best: { rotate: Rotation; page: OcrPage; prepared: PreparedImage; score: number } | null = null;
  for (const candidate of candidates) {
    const prepared = await loadUpright(file, candidate);
    const page = await readPage(prepared);
    const score = orientationScore(page.words);
    if (!best || score > best.score) best = { rotate: candidate, page, prepared, score };
  }
  if (!best) throw new Error("見本を読めませんでした");

  // 表示・保存用は反転していない画像にする（管理者が見るのは実際のスクショ）
  const display = await loadUpright(file, best.rotate, best.rotate, { invert: false });
  const uprightBlob = await new Promise<Blob | null>((resolve) =>
    display.canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92),
  );
  if (!uprightBlob) throw new Error("見本を作れませんでした");

  return {
    rotate: best.rotate,
    page: best.page,
    prepared: best.prepared,
    uprightBlob,
    sample: {
      width: best.prepared.width,
      height: best.prepared.height,
      unitHeight: Number(medianWordHeight(best.page.words).toFixed(1)),
      words: best.page.words
        .filter((word) => word.text.trim().length >= 1 && isReadableWord(word.text))
        .map((word) => ({
          text: word.text,
          box: { x: Math.round(word.x), y: Math.round(word.y), w: Math.round(word.w), h: Math.round(word.h) },
        })),
    },
  };
}

export type ReportImageOutcome = {
  /** 当てはまった様式。null なら未対応（手入力へ戻す） */
  template: ImageTemplate | null;
  rotation: Rotation;
  result: ReadResult | null;
  /** 点数が近い様式が複数あり、どれか選ばせる必要がある */
  ambiguous: boolean;
  /** 切り出した欄の画像（fieldId → data URL） */
  crops: Record<string, string>;
  /** 読むのに使った画像（確認画面に出す。回転補正済み） */
  prepared: PreparedImage;
  /** 試した角度と点数。未対応のときに何を試したか示す */
  attempts: { rotate: Rotation; score: number }[];
};

const uniqueRotations = (templates: readonly ImageTemplate[]): Rotation[] => {
  const hints = templates
    .map((template) => template.definition.orientation?.rotate)
    .filter((value): value is Rotation => value === 0 || value === 90 || value === 180 || value === 270);
  return Array.from(new Set<Rotation>([...hints, 0, 90, 270, 180]));
};

/**
 * 1枚を読む。様式の向きヒントから順に試し、当てはまった様式で値まで読む。
 * どの様式にも当てはまらなければ template=null を返す（手入力のまま進める）。
 */
export async function readReportImage(
  file: Blob,
  templates: readonly ImageTemplate[],
  options: { reportDate?: string | null; onStep?: (step: string) => void } = {},
): Promise<ReportImageOutcome> {
  const attempts: { rotate: Rotation; score: number }[] = [];
  let best: { prepared: PreparedImage; page: OcrPage; template: ImageTemplate; score: number; ambiguous: boolean } | null = null;

  for (const rotate of uniqueRotations(templates)) {
    options.onStep?.("画像を読んでいます");
    let prepared = await loadUpright(file, rotate);
    let page = await readPage(prepared);
    // 写真で撮った画面は数度傾く。傾いたままだと行の左の見出しと右の数字が食い違う
    const skew = estimateSkewAngle(page);
    if (skew !== 0) {
      prepared = await loadUpright(file, rotate, rotate - skew);
      page = await readPage(prepared);
    }
    const choice = chooseTemplate(page, templates);
    const score = choice.ranked[0]?.score ?? 0;
    attempts.push({ rotate, score });
    const matched = choice.best ? templates.find((t) => t.key === choice.best?.templateKey) ?? null : null;
    if (matched && (!best || score > best.score)) {
      best = { prepared, page, template: matched, score, ambiguous: choice.ambiguous };
    }
    // 様式が確かに分かったらそこで止める（角度を全部試すと端末が待たされる）
    if (choice.best?.level === "high") break;
  }

  if (!best) {
    const prepared = await loadUpright(file, 0);
    return { template: null, rotation: 0, result: null, ambiguous: false, crops: {}, prepared, attempts };
  }

  options.onStep?.("件数を読み取っています");
  const located = locateFields(best.page, best.template);
  const first = readAreas(best.page, best.template, located, { reportDate: options.reportDate });
  const { refinements, crops } = await refineAreas(best.prepared, located.areas);
  const refined = applyRefinements(best.template, first, refinements, { reportDate: options.reportDate });
  const result = completeRead(best.template, located.match, refined);

  return {
    template: best.template,
    rotation: best.prepared.rotate,
    result,
    ambiguous: best.ambiguous,
    crops,
    prepared: best.prepared,
    attempts,
  };
}
