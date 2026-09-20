// ============================================================
// 日報の原本画像（配完個数表などのスクショ）から件数を読むための「様式」。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-1 / RIMG-3）
//
// ここは OCR エンジンに依存しない純粋関数だけを置く。
// Web は tesseract.js、モバイルは ML Kit と読み取り手段が違うので、
// 「語と座標の配列（OcrPage）」まで各アプリで揃えてから、この判定・抽出を共有する。
//
// この設計が守ること:
//   - 様式は**データ**（管理画面で足せる）。形式が増えるたびにコードを書かない
//   - 位置は固定ピクセルではなく**見出し文字からの相対**で持つ。
//     画面サイズ・倍率が違っても、同じ見出しが写っていれば読める
//   - トリミングで見出しが切れたら、その項目は「未取得」にする。**0で埋めない**
//   - 想定と違うスクショは点数が下がる。点数が足りなければ「未対応」として手入力に戻す
//   - 読めた値には必ず出どころ（枠）を付ける。確認画面で原本と見比べられるようにする
// ============================================================

/** 画像内の矩形（左上原点・ピクセル） */
export type Box = { x: number; y: number; w: number; h: number };

/** OCR が返した語。confidence は 0..1（取れないエンジンは省略可） */
export type OcrWord = { text: string; x: number; y: number; w: number; h: number; confidence?: number };

/** 1枚ぶんの読み取り結果。width/height は OCR にかけた画像の寸法 */
export type OcrPage = { width: number; height: number; words: OcrWord[] };

/** 見出しの指定。sampleBox は見本画像でその見出しがあった位置（ズレ補正の基準に使う） */
export type AnchorSpec = {
  text: string;
  /** exact=完全一致 / contains=含む / fuzzy=誤読を許す */
  match: "exact" | "contains" | "fuzzy";
  /** 同じ語が複数あるときに何番目を使うか（1始まり・読み順）。null なら最も確からしいもの */
  occurrence?: number | null;
  sampleBox?: Box | null;
};

export type ValueSpec = {
  /** date は「画像に書かれた対象日」。日報項目には入れず、対象日との突き合わせに使う */
  type: "int" | "decimal" | "time" | "date";
  /** 実務上あり得ない値を弾くための範囲。読めた値が外れたら「要確認」にする */
  min?: number | null;
  max?: number | null;
};

export type Direction = "right" | "left" | "below" | "above";
export type PickRule = "nearest" | "first" | "last" | "max";

export type FieldLocator =
  /** 見出しの隣（上下左右）にある数字を読む。既定の方法 */
  | {
      kind: "anchor";
      anchor: AnchorSpec;
      direction: Direction;
      /** 見出しからどれだけ離れた語まで見るか。**文字高の倍数**で持つ（倍率非依存） */
      maxGap?: number;
      /** 同じ行とみなす縦ズレの許容。文字高の倍数 */
      lineTolerance?: number;
      pick?: PickRule;
      /**
       * 見本で値があった場所（管理者が囲んだ枠）。
       * 見出しが今どこにあるかで平行移動して使う。
       * これが無いと「見出しから値までの帯」ごと切り出すことになり、
       * 矢印や隣の要素を巻き込んで読み違える。
       */
      valueHint?: Box | null;
    }
  /** 表の「行見出し×列見出し」の交点を読む */
  | { kind: "cell"; row: AnchorSpec; column: AnchorSpec }
  /**
   * 見本画像の座標で欄を指す。ズレと倍率は補正して使う。
   * column / row を付けると、**読むときに見つけた見出しの位置へ合わせ直す**。
   * 相手の画面に列が増減しても、座標だけを信じて隣の欄を読むことを防ぐ。
   */
  | { kind: "region"; rect: Box; column?: AnchorSpec | null; row?: AnchorSpec | null };

export type TemplateField = {
  id: string;
  /**
   * entry=日報項目へ入れる値
   * date=画像に書かれた対象日（日報には入れない）
   * check=**検算のためだけに読む欄**（日報には入れない）
   *
   * check を増やすと、表の中の「合計＝内訳」「A＝B＋C」といった関係を何本も確かめられる。
   * 式が全部閉じれば、欄を取り違えて読んでいないことを機械が示せる＝人が毎回見比べずに済む。
   */
  role?: "entry" | "date" | "check";
  /** 日報項目への結び付け（unit_fields の unit_id / field_key）。role=date では空でよい */
  unitId: string;
  fieldKey: string;
  label: string;
  value: ValueSpec;
  locator: FieldLocator;
  /** 読めなかったときに「要確認」へ落とすか（false なら空欄のままでよい項目） */
  required: boolean;
};

/** 合計＝明細の和、のような検算。合わなければ確認を促す（自動で直さない） */
export type TemplateCheck = { kind: "sum"; totalFieldId: string; partFieldIds: string[] };

export type ImageTemplateDefinition = {
  match: {
    /** これが無ければその様式ではない、という見出し */
    required: AnchorSpec[];
    /** あれば確度が上がる見出し */
    optional?: AnchorSpec[];
    /** 採用する最低点（0..1）。既定 0.6 */
    minScore?: number | null;
  };
  fields: TemplateField[];
  checks?: TemplateCheck[];
  /**
   * この様式が画面内で回転して表示されるときの角度（時計回り）。
   * ヤマトの配達集計精算書は縦画面に横長の表を収めるため90度回って写る。
   * 読み取り側はまずこの角度を試し、点数が足りなければ他の角度も試す。
   */
  orientation?: { rotate: 0 | 90 | 180 | 270 } | null;
  /**
   * 見本画像の寸法・文字高と、見本を読んだときの語。
   * 語を持っておくと、見出し数個ではなく一致した語すべてからズレと倍率を出せる
   * （トリミングや画面サイズ違いでの位置合わせが目に見えて安定する）。
   */
  sample?: {
    width: number;
    height: number;
    unitHeight: number;
    /** 1段目で読んだ語（位置合わせの対応点。読み取り時の1段目と同じ質にしておく） */
    words?: SampleWord[];
    /**
     * 見出しの欄だけを切り出して読み直した文字。見出しの候補と自動選択に使う。
     * 全体を一度に読むと小さい見出しは崩れる（「ネコポス個数」→「ホス人数」）が、
     * 欄を切り出すと行見出しと題はほぼ正しく読める（数字で効いた手と同じ）。
     */
    labels?: SampleWord[];
  } | null;
};

export type ImageTemplate = {
  key: string;
  version: string;
  name: string;
  carrierId: string | null;
  definition: ImageTemplateDefinition;
};

/** 見本を読んだときの語。位置合わせの対応点に使う */
export type SampleWord = { text: string; box: Box };

export const DEFAULT_MIN_SCORE = 0.6;
const DEFAULT_MAX_GAP = 8;
const DEFAULT_LINE_TOLERANCE = 0.7;
const FUZZY_THRESHOLD = 0.72;

// ------------------------------------------------------------
// 文字の正規化
// ------------------------------------------------------------

/**
 * 見出しの照合用に文字を揃える。全角/半角・大文字小文字・記号・空白の差で
 * 見出しを見失わないようにする（OCR は「配 完」のように分けて返すことがある）。
 */
export function normalizeForMatch(text: string): string {
  return (text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[.,:;、。・/|()[\]{}「」『』【】<>＜＞*#＿_~^"'`\\-]/g, "");
}

/** 編集距離。誤読（「配完」→「配宗」）を許した照合に使う */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0..1 の一致度 */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

// ------------------------------------------------------------
// 語を行にまとめる
// ------------------------------------------------------------

export type OcrLine = { words: OcrWord[]; text: string; box: Box };

const boxOf = (words: readonly OcrWord[]): Box => {
  const x = Math.min(...words.map((w) => w.x));
  const y = Math.min(...words.map((w) => w.y));
  const right = Math.max(...words.map((w) => w.x + w.w));
  const bottom = Math.max(...words.map((w) => w.y + w.h));
  return { x, y, w: right - x, h: bottom - y };
};

const centerY = (b: Box) => b.y + b.h / 2;
const centerX = (b: Box) => b.x + b.w / 2;

/**
 * 縦の重なりで語を行にまとめ、行内は左から並べる。
 * 見出しが複数の語に割れていても1つの見出しとして照合できるようにするため。
 */
export function buildLines(words: readonly OcrWord[]): OcrLine[] {
  const usable = words.filter((w) => w.text.trim() !== "" && w.w > 0 && w.h > 0);
  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: OcrWord[][] = [];
  for (const word of sorted) {
    const line = lines.find((group) => {
      const box = boxOf(group);
      const overlap = Math.min(box.y + box.h, word.y + word.h) - Math.max(box.y, word.y);
      return overlap > Math.min(box.h, word.h) * 0.5;
    });
    if (line) line.push(word);
    else lines.push([word]);
  }
  return lines.map((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    return { words: ordered, text: normalizeForMatch(ordered.map((w) => w.text).join("")), box: boxOf(ordered) };
  });
}

/** 文字高の代表値。倍率の違いを吸収する物差しに使う */
export function medianWordHeight(words: readonly OcrWord[]): number {
  const heights = words.filter((w) => w.h > 0).map((w) => w.h).sort((a, b) => a - b);
  if (heights.length === 0) return 0;
  return heights[Math.floor(heights.length / 2)];
}

// ------------------------------------------------------------
// 見出しを探す
// ------------------------------------------------------------

export type AnchorHit = { spec: AnchorSpec; box: Box; score: number; text: string };

/**
 * 行の中を語の連なりで走査して見出しを探す。
 * OCR が語を割っても（「配完」「個数」）、続きの語をつないで照合する。
 */
export function findAnchorHits(lines: readonly OcrLine[], spec: AnchorSpec): AnchorHit[] {
  const target = normalizeForMatch(spec.text);
  if (!target) return [];
  const hits: AnchorHit[] = [];
  for (const line of lines) {
    for (let start = 0; start < line.words.length; start += 1) {
      let joined = "";
      for (let end = start; end < line.words.length; end += 1) {
        joined += normalizeForMatch(line.words[end].text);
        if (joined.length > target.length * 2 + 4) break;
        const window = line.words.slice(start, end + 1);
        let score = 0;
        if (spec.match === "exact") {
          score = joined === target ? 1 : 0;
        } else if (spec.match === "contains") {
          score = joined.includes(target) ? (target.length / joined.length) * 0.9 + 0.1 : 0;
        } else {
          const ratio = similarity(joined, target);
          score = ratio >= FUZZY_THRESHOLD ? ratio : 0;
        }
        if (score > 0) {
          hits.push({ spec, box: boxOf(window), score, text: window.map((w) => w.text).join("") });
          break; // 同じ開始位置で一番短い一致を採る（余分な語を巻き込まない）
        }
      }
    }
  }
  // 読み順（上から下・左から右）に並べる。occurrence の番号はこの順
  hits.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return hits;
}

/**
 * occurrence があればその番号、無ければ最も一致度の高いものを1つ選ぶ。
 *
 * **同じくらい確からしい候補が離れた場所にあるときは、決めずに null を返す。**
 * 「持戻」が「配完＋持戻」にも一致するような見出しで隣の列へ吸い寄せられると、
 * はっきり読める数字を堂々と間違えて入れてしまう。曖昧な見出しは、無いほうがまだ安全。
 */
export function resolveAnchor(lines: readonly OcrLine[], spec: AnchorSpec): AnchorHit | null {
  const hits = findAnchorHits(lines, spec);
  if (hits.length === 0) return null;
  if (spec.occurrence != null && spec.occurrence >= 1) return hits[spec.occurrence - 1] ?? null;
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const rival = sorted[1];
  if (rival && best.score - rival.score < 0.05) {
    const apart =
      Math.abs(centerX(best.box) - centerX(rival.box)) > best.box.w ||
      Math.abs(centerY(best.box) - centerY(rival.box)) > best.box.h;
    if (apart) return null;
  }
  return best;
}

// ------------------------------------------------------------
// 様式の判定
// ------------------------------------------------------------

export type TemplateMatchResult = {
  templateKey: string;
  templateVersion: string;
  name: string;
  /** 0..1。必須の見出しは重み1、任意は重み0.5 */
  score: number;
  /** 見つからなかった必須見出し。トリミングで切れた場合もここに出る */
  missingRequired: string[];
  hits: AnchorHit[];
  /**
   * high=様式が確認できた / low=一部しか確認できない（読むが要確認）/ none=別の画面
   * トリミングや画質で見出しが1つ欠けただけで手入力に戻さないための段階。
   */
  level: "high" | "low" | "none";
  accepted: boolean;
};

const OPTIONAL_WEIGHT = 0.5;
/** これを下回ったら「別の画面のスクショ」として読まない */
const REJECT_SCORE = 0.3;

export function scoreTemplate(lines: readonly OcrLine[], template: ImageTemplate): TemplateMatchResult {
  const required = template.definition.match?.required ?? [];
  const optional = template.definition.match?.optional ?? [];
  const minScore = template.definition.match?.minScore ?? DEFAULT_MIN_SCORE;

  const hits: AnchorHit[] = [];
  const missingRequired: string[] = [];
  let got = 0;
  for (const spec of required) {
    const hit = resolveAnchor(lines, spec);
    if (hit) {
      hits.push(hit);
      got += 1;
    } else missingRequired.push(spec.text);
  }
  for (const spec of optional) {
    const hit = resolveAnchor(lines, spec);
    if (hit) {
      hits.push(hit);
      got += OPTIONAL_WEIGHT;
    }
  }
  const total = required.length + optional.length * OPTIONAL_WEIGHT;
  const score = total > 0 ? got / total : 0;
  const level: TemplateMatchResult["level"] =
    total === 0 || score < Math.min(REJECT_SCORE, minScore) ? "none" : score >= minScore ? "high" : "low";
  return {
    templateKey: template.key,
    templateVersion: template.version,
    name: template.name,
    score,
    missingRequired,
    hits,
    level,
    accepted: level !== "none",
  };
}

export type TemplateChoice = {
  best: TemplateMatchResult | null;
  /** 点数順。どれも届かなければ accepted=false のまま返す（「未対応」の説明に使う） */
  ranked: TemplateMatchResult[];
  /** 1位と2位が僅差。どちらか選ばせる */
  ambiguous: boolean;
};

/** 複数の様式から当てはまるものを選ぶ。届かなければ best=null（＝未対応・手入力へ） */
export function chooseTemplate(page: OcrPage, templates: readonly ImageTemplate[]): TemplateChoice {
  const lines = buildLines(page.words);
  const ranked = templates.map((t) => scoreTemplate(lines, t)).sort((a, b) => b.score - a.score);
  const high = ranked.filter((r) => r.level === "high");
  const accepted = high.length > 0 ? high : ranked.filter((r) => r.level === "low");
  const best = accepted[0] ?? null;
  const ambiguous = accepted.length > 1 && accepted[0].score - accepted[1].score < 0.05;
  return { best, ranked, ambiguous };
}

// ------------------------------------------------------------
// ズレ・倍率の補正
// ------------------------------------------------------------

export type Transform = { scaleX: number; scaleY: number; dx: number; dy: number };
export const IDENTITY: Transform = { scaleX: 1, scaleY: 1, dx: 0, dy: 0 };

const clampScale = (value: number) => (Number.isFinite(value) && value > 0.2 && value < 5 ? value : 1);
const median = (values: number[]) =>
  values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * 見本画像→今回の画像 の平行移動と倍率を、見つかった見出しの位置から推定する。
 * 画面サイズの違い（倍率）とトリミング（平行移動）の両方をこれで吸収する。
 * 見出しが1つしか取れなければ文字高の比を倍率に使う。
 */
export function estimateTransform(hits: readonly AnchorHit[], sampleUnitHeight: number, pageUnitHeight: number): Transform {
  const pairs = hits.filter((h) => h.spec.sampleBox);
  const fallbackScale =
    sampleUnitHeight > 0 && pageUnitHeight > 0 ? clampScale(pageUnitHeight / sampleUnitHeight) : 1;
  if (pairs.length === 0) return { scaleX: fallbackScale, scaleY: fallbackScale, dx: 0, dy: 0 };

  const axisScale = (get: (b: Box) => number): number => {
    if (pairs.length < 2) return fallbackScale;
    const sampleValues = pairs.map((p) => get(p.spec.sampleBox as Box));
    const pageValues = pairs.map((p) => get(p.box));
    const sampleSpread = Math.max(...sampleValues) - Math.min(...sampleValues);
    const pageSpread = Math.max(...pageValues) - Math.min(...pageValues);
    // 見出しが近すぎる軸は倍率を出せない。文字高の比に任せる
    if (sampleSpread < sampleUnitHeight * 2) return fallbackScale;
    return clampScale(pageSpread / sampleSpread);
  };

  const scaleX = axisScale(centerX);
  const scaleY = axisScale(centerY);
  const dx = median(pairs.map((p) => centerX(p.box) - scaleX * centerX(p.spec.sampleBox as Box)));
  const dy = median(pairs.map((p) => centerY(p.box) - scaleY * centerY(p.spec.sampleBox as Box)));
  return { scaleX, scaleY, dx, dy };
}

/**
 * 傾き・ずれを外れ値に強く求める（Theil–Sen）。
 * OCRの誤読で数点が飛んでも、中央値を採るので位置合わせが壊れない。
 */
function fitAxis(points: readonly { s: number; t: number }[], minSpread: number): { scale: number; offset: number } | null {
  if (points.length < 2) return null;
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const ds = points[j].s - points[i].s;
      if (Math.abs(ds) < minSpread) continue;
      slopes.push((points[j].t - points[i].t) / ds);
    }
  }
  if (slopes.length === 0) return null;
  const scale = clampScale(median(slopes));
  const offset = median(points.map((p) => p.t - scale * p.s));
  return { scale, offset };
}

/**
 * 見本と今回の画像で同じ語を突き合わせ、対応点から倍率とずれを出す。
 * 同じ語が複数ある場合は取り違えるので、両方で1回しか出てこない語だけを使う。
 */
export type TransformFit = {
  transform: Transform;
  /** 対応が取れた語の数 */
  pairs: number;
  /**
   * 見本を当てはめたときのズレ（文字高を1とした割合）の中央値。
   * 拡大・縮小・トリミングだけならここは小さいままになる。
   */
  residual: number | null;
  /**
   * 当てはまらなかった語の割合。
   * 表の一部だけが動く（列が増える・欄が入れ替わる）と、中央値は動かないのにここが上がる。
   * **数字が並ぶ表で隣の欄を読んでしまう事故は、たいていこの形で始まる。**
   */
  outlierRate: number | null;
};

export function estimateTransformFromWords(
  sampleWords: readonly SampleWord[],
  page: OcrPage,
  fallback: Transform,
): TransformFit {
  const countBy = (entries: readonly { key: string }[]) => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
    return counts;
  };
  const sample = sampleWords
    .map((word) => ({ key: normalizeForMatch(word.text), box: word.box }))
    .filter((word) => word.key.length >= 2);
  const target = page.words
    .map((word) => ({ key: normalizeForMatch(word.text), box: { x: word.x, y: word.y, w: word.w, h: word.h } }))
    .filter((word) => word.key.length >= 2);
  const sampleCounts = countBy(sample);
  const targetCounts = countBy(target);

  const pairs: { s: Box; t: Box }[] = [];
  for (const word of sample) {
    if (sampleCounts.get(word.key) !== 1 || targetCounts.get(word.key) !== 1) continue;
    const hit = target.find((t) => t.key === word.key);
    if (hit) pairs.push({ s: word.box, t: hit.box });
  }
  if (pairs.length < 3) return { transform: fallback, pairs: pairs.length, residual: null, outlierRate: null };

  const spread = Math.max(8, ...sample.map((word) => word.box.h)) * 2;
  const x = fitAxis(pairs.map((p) => ({ s: centerX(p.s), t: centerX(p.t) })), spread);
  const y = fitAxis(pairs.map((p) => ({ s: centerY(p.s), t: centerY(p.t) })), spread);
  if (!x || !y) return { transform: fallback, pairs: pairs.length, residual: null, outlierRate: null };

  const transform: Transform = { scaleX: x.scale, scaleY: y.scale, dx: x.offset, dy: y.offset };
  const unit = Math.max(1, median(page.words.filter((w) => w.h > 0).map((w) => w.h)));
  const deviations = pairs.map((pair) => {
    const mapped = applyTransform(pair.s, transform);
    return Math.max(Math.abs(centerX(mapped) - centerX(pair.t)), Math.abs(centerY(mapped) - centerY(pair.t))) / unit;
  });
  const outlierRate = deviations.filter((value) => value > 1).length / deviations.length;
  return { transform, pairs: pairs.length, residual: median(deviations), outlierRate };
}

export function applyTransform(rect: Box, t: Transform): Box {
  return { x: rect.x * t.scaleX + t.dx, y: rect.y * t.scaleY + t.dy, w: rect.w * t.scaleX, h: rect.h * t.scaleY };
}

// ------------------------------------------------------------
// 値の読み取り
// ------------------------------------------------------------

/**
 * 見つけた年のうち、基準日（対象営業日）に最も近いものを採る。
 * 「12/31」のスクショを1月に出したときに年をまたいで取り違えないため。
 */
function resolveYear(month: number, day: number, referenceDate: string | null | undefined): number {
  const reference = referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ? referenceDate : null;
  const baseYear = reference ? Number(reference.slice(0, 4)) : new Date().getFullYear();
  if (!reference) return baseYear;
  const target = Date.parse(`${reference}T00:00:00Z`);
  let best = baseYear;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
    const gap = Math.abs(Date.UTC(year, month - 1, day) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = year;
    }
  }
  return best;
}

/**
 * 数字だけの欄で、文字として読まれてしまったものを数字に戻す。
 * 「0」1文字は eng の辞書で O や U になりやすい（実測: 単独の0が "U" 87%）。
 * **数字を入れる欄だと分かっている場合にだけ**、短い綴りに限って読み替える。
 */
const CONFUSABLE: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0", U: "0", u: "0",
  l: "1", I: "1", i: "1", "|": "1", "]": "1",
  Z: "2", z: "2", S: "5", s: "5", b: "6", G: "6", T: "7", B: "8", g: "9", q: "9",
};
function numeralize(text: string): string {
  if (/\d/.test(text)) return text;
  const core = text.replace(/[^A-Za-z|\]]/g, "");
  if (core.length === 0 || core.length > 3) return text;
  if (![...core].every((char) => CONFUSABLE[char])) return text;
  return [...core].map((char) => CONFUSABLE[char]).join("");
}

/** 数字らしさ。OCR の「1,234個」「12 件」からも値を取り出す */
export function parseValue(
  raw: string,
  spec: ValueSpec,
  ctx: { referenceDate?: string | null } = {},
): number | string | null {
  const text = (raw ?? "").normalize("NFKC").trim();
  if (!text) return null;
  if (spec.type === "date") {
    const compact = text.replace(/[\s]/g, "");
    const full = compact.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    const short = full ? null : compact.match(/(?:^|[^\d])(\d{1,2})[-/.月](\d{1,2})日?/);
    const month = full ? Number(full[2]) : short ? Number(short[1]) : null;
    const day = full ? Number(full[3]) : short ? Number(short[2]) : null;
    if (month == null || day == null || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const year = full ? Number(full[1]) : resolveYear(month, day, ctx.referenceDate);
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // 2月30日のような実在しない日付を通さない
    const check = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day || check.getUTCMonth() + 1 !== month) return null;
    return iso;
  }
  if (spec.type === "time") {
    const m = text.match(/(\d{1,2})\s*[:：時]\s*(\d{1,2})/);
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const cleaned = numeralize(text.replace(/[,\s]/g, ""));
  const m = spec.type === "decimal" ? cleaned.match(/-?\d+(?:\.\d+)?/) : cleaned.match(/-?\d+/);
  if (!m) return null;
  const value = Number(m[0]);
  if (!Number.isFinite(value)) return null;
  return spec.type === "int" ? Math.trunc(value) : value;
}

export type FieldReadStatus =
  /** 読めた */
  | "read"
  /** 見出しが写っていない（トリミング・様式違い）。0で埋めない */
  | "no_anchor"
  /** 場所は決まったが値が無い（空欄）。0で埋めない */
  | "not_found"
  /** 読めたが実務上あり得ない値 */
  | "out_of_range"
  /** 読めたが確度が低い。値は見せるが、そのまま通さない */
  | "uncertain";

export type FieldRead = {
  fieldId: string;
  unitId: string;
  fieldKey: string;
  label: string;
  role: "entry" | "date" | "check";
  raw: string | null;
  value: number | string | null;
  status: FieldReadStatus;
  /** 確認画面で原本に重ねる枠。値があるはずの範囲 */
  box: Box | null;
  anchorBox: Box | null;
  confidence: number;
  /** その枠を切り出して読み直した値か（二段目のOCR） */
  refined: boolean;
};

/** 値があるはずの範囲。ここだけを切り出して読み直すと、表の数字は桁違いに正確に読める */
export type FieldArea = {
  fieldId: string;
  box: Box | null;
  anchorBox: Box | null;
  /** 場所を決められなかった理由 */
  missing: "anchor" | "row" | "column" | null;
  /**
   * 見本の座標と、読むときに見つけた見出しの位置のズレ（欄の幅・高さを1とした割合）。
   * 大きいほど「相手の画面が変わった」可能性が高く、値をそのまま信じない。
   */
  drift: number | null;
};

export type LocateResult = {
  match: TemplateMatchResult;
  /** 文字高（この画像での物差し） */
  unit: number;
  transform: Transform;
  /** 見本の当てはまり具合。residual が大きい＝画面の作りが変わった疑い */
  fit: TransformFit;
  areas: FieldArea[];
};

/**
 * 見本の当てはまりがこれを超えて崩れたら、座標で指した欄を信じない。
 * 拡大・縮小・トリミングでは超えず、列の増減や行の入れ替えで超える。
 */
export const MAX_SAFE_RESIDUAL = 1.2;
/** 当てはまらない語がこの割合を超えたら、表の作りが変わったとみなす */
export const MAX_SAFE_OUTLIER_RATE = 0.25;

const wordConfidence = (words: readonly OcrWord[]): number => {
  const known = words.map((w) => w.confidence).filter((c): c is number => typeof c === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0.5;
};

const expand = (box: Box, x: number, y: number): Box => ({
  x: box.x - x,
  y: box.y - y,
  w: box.w + x * 2,
  h: box.h + y * 2,
});

function areaForAnchorLocator(locator: Extract<FieldLocator, { kind: "anchor" }>, ctx: { lines: OcrLine[]; unit: number }): FieldArea["box"] | null {
  const anchor = resolveAnchor(ctx.lines, locator.anchor);
  if (!anchor) return null;
  const unit = ctx.unit > 0 ? ctx.unit : anchor.box.h;
  const gap = (locator.maxGap ?? DEFAULT_MAX_GAP) * unit;
  const tolerance = (locator.lineTolerance ?? DEFAULT_LINE_TOLERANCE) * Math.max(unit, anchor.box.h);
  if (locator.direction === "right") {
    return { x: anchor.box.x + anchor.box.w, y: centerY(anchor.box) - anchor.box.h / 2 - tolerance, w: gap, h: anchor.box.h + tolerance * 2 };
  }
  if (locator.direction === "left") {
    return { x: anchor.box.x - gap, y: centerY(anchor.box) - anchor.box.h / 2 - tolerance, w: gap, h: anchor.box.h + tolerance * 2 };
  }
  const width = Math.max(anchor.box.w, unit * 3) + tolerance * 2;
  if (locator.direction === "below") {
    return { x: centerX(anchor.box) - width / 2, y: anchor.box.y + anchor.box.h, w: width, h: gap };
  }
  return { x: centerX(anchor.box) - width / 2, y: anchor.box.y - gap, w: width, h: gap };
}

/**
 * 様式に沿って「値があるはずの範囲」を今回の画像の座標で決める。
 * 見出しが見つからない項目は box=null にして、0で埋めずに未取得として返す。
 */
export function locateFields(page: OcrPage, template: ImageTemplate): LocateResult {
  const lines = buildLines(page.words);
  const match = scoreTemplate(lines, template);
  const unit = medianWordHeight(page.words);
  const byAnchors = estimateTransform(match.hits, template.definition.sample?.unitHeight ?? 0, unit);
  // 見本の語を持っている様式は、一致した語すべてから位置合わせする（見出し数個より安定する）
  const fit: TransformFit = template.definition.sample?.words?.length
    ? estimateTransformFromWords(template.definition.sample.words, page, byAnchors)
    : { transform: byAnchors, pairs: 0, residual: null, outlierRate: null };
  const transform = fit.transform;

  const areas: FieldArea[] = (template.definition.fields ?? []).map((field) => {
    const locator = field.locator;
    if (locator.kind === "anchor") {
      const anchor = resolveAnchor(lines, locator.anchor);
      if (!anchor) return { fieldId: field.id, box: null, anchorBox: null, missing: "anchor", drift: null };
      // 見本で値があった場所を、見出しのズレぶんだけ動かして使う（帯ごと切り出さない）
      if (locator.valueHint && locator.anchor.sampleBox) {
        const where = applyTransform(locator.anchor.sampleBox, transform);
        const dx = centerX(anchor.box) - centerX(where);
        const dy = centerY(anchor.box) - centerY(where);
        const hint = applyTransform(locator.valueHint, transform);
        return {
          fieldId: field.id,
          box: { x: hint.x + dx, y: hint.y + dy, w: hint.w, h: hint.h },
          anchorBox: anchor.box,
          missing: null,
          drift: null,
        };
      }
      return {
        fieldId: field.id,
        box: areaForAnchorLocator(locator, { lines, unit }),
        anchorBox: anchor.box,
        missing: null,
        drift: null,
      };
    }
    if (locator.kind === "cell") {
      const row = resolveAnchor(lines, locator.row);
      const column = resolveAnchor(lines, locator.column);
      if (!row || !column) {
        return {
          fieldId: field.id,
          box: null,
          anchorBox: (row ?? column)?.box ?? null,
          missing: row ? "column" : "row",
          drift: null,
        };
      }
      const rowBand = expand(row.box, 0, Math.max(row.box.h, unit) * 0.15);
      const columnBand = expand(column.box, Math.max(column.box.w * 0.15, unit * 0.4), 0);
      const box: Box = { x: columnBand.x, y: rowBand.y, w: columnBand.w, h: rowBand.h };
      return { fieldId: field.id, box, anchorBox: row.box, missing: null, drift: null };
    }

    // 見本座標の欄。見出しを持っていれば、読むときに見つけた位置へ合わせ直す
    const predicted = applyTransform(locator.rect, transform);
    let box = predicted;
    let drift: number | null = null;
    let anchorBox: Box | null = null;
    const column = locator.column ? resolveAnchor(lines, locator.column) : null;
    const row = locator.row ? resolveAnchor(lines, locator.row) : null;
    /**
     * 「見本でその見出しがあった場所」と「今この画像で見つけた場所」の差だけ欄を動かす。
     * 見出しの中心へ欄を寄せてはいけない（見出しは欄の真上や左端にあるとは限らない）。
     * 見本での位置を持たない見出しでは動かしようがないので、座標のまま使う。
     */
    const delta = (hit: AnchorHit | null, axis: "x" | "y"): number | null => {
      if (!hit?.spec.sampleBox) return null;
      const where = applyTransform(hit.spec.sampleBox, transform);
      return axis === "x" ? centerX(hit.box) - centerX(where) : centerY(hit.box) - centerY(where);
    };
    const dx = delta(column, "x");
    const dy = delta(row, "y");
    if (dx != null && predicted.w > 0) {
      box = { ...box, x: box.x + dx };
      drift = Math.max(drift ?? 0, Math.abs(dx) / predicted.w);
      anchorBox = column?.box ?? null;
    }
    if (dy != null && predicted.h > 0) {
      box = { ...box, y: box.y + dy };
      drift = Math.max(drift ?? 0, Math.abs(dy) / predicted.h);
      anchorBox = anchorBox ?? row?.box ?? null;
    }
    // 見出しは「読めたら使う」。読めない様式（列見出しが細かい表など）でも値は捨てない。
    // 代わりに、盤面そのものが見本と違う形に変わっていないかを下の当てはまり具合で見る
    return { fieldId: field.id, box, anchorBox, missing: null, drift };
  });

  return { match, unit, transform, fit, areas };
}

/** これを超えるズレは「相手の画面が変わったかもしれない」として確認に回す */
export const MAX_SAFE_DRIFT = 0.5;

const emptyRead = (field: TemplateField, area: FieldArea): FieldRead => ({
  fieldId: field.id,
  unitId: field.unitId,
  fieldKey: field.fieldKey,
  label: field.label,
  role: field.role ?? "entry",
  raw: null,
  value: null,
  status: area.missing ? "no_anchor" : "not_found",
  box: area.box,
  anchorBox: area.anchorBox,
  confidence: 0,
  refined: false,
});

/** 枠の中に入っている語をつないで値にする（1段目のOCRだけで読む場合） */
export function readAreas(
  page: OcrPage,
  template: ImageTemplate,
  located: LocateResult,
  options: { reportDate?: string | null } = {},
): FieldRead[] {
  // 見本の当てはまりが悪い＝相手の画面の作りが変わった疑い。座標で指した欄を信じない
  const layoutChanged =
    (located.fit.residual ?? 0) > MAX_SAFE_RESIDUAL || (located.fit.outlierRate ?? 0) > MAX_SAFE_OUTLIER_RATE;
  return (template.definition.fields ?? []).map((field) => {
    const area = located.areas.find((a) => a.fieldId === field.id);
    if (!area || !area.box) {
      return emptyRead(field, area ?? { fieldId: field.id, box: null, anchorBox: null, missing: "anchor", drift: null });
    }
    const box = area.box;
    const inside = page.words.filter((word) => {
      const overlapX = Math.min(box.x + box.w, word.x + word.w) - Math.max(box.x, word.x);
      const overlapY = Math.min(box.y + box.h, word.y + word.h) - Math.max(box.y, word.y);
      if (overlapX <= 0 || overlapY <= 0) return false;
      return (overlapX * overlapY) / Math.max(1, word.w * word.h) >= 0.5;
    });
    if (inside.length === 0) return emptyRead(field, area);
    const ordered = [...inside].sort((a, b) => a.y - b.y || a.x - b.x);
    const raw = ordered.map((w) => w.text).join("");
    const value = parseValue(raw, field.value, { referenceDate: options.reportDate ?? null });
    if (value == null) return { ...emptyRead(field, area), raw };
    // 欄を指す指定では、値が欄の真ん中にあるはずだ。端に寄っていれば隣の欄を拾った疑いがある
    const fixedCell = field.locator.kind !== "anchor";
    const content = boxOf(ordered);
    const offCentre =
      fixedCell &&
      (Math.abs(centerX(content) - centerX(box)) > box.w * 0.35 ||
        Math.abs(centerY(content) - centerY(box)) > box.h * 0.35);
    const drifted = (area.drift ?? 0) > MAX_SAFE_DRIFT || (layoutChanged && field.locator.kind === "region");
    return {
      ...emptyRead(field, area),
      raw,
      value,
      status: offCentre || drifted ? "uncertain" : "read",
      box: content,
      confidence: wordConfidence(ordered),
      refined: false,
    };
  });
}

/**
 * 枠を切り出して読み直した結果（2段目のOCR）。表の数字はこちらの方が確実に読める。
 * clipped=切り出しの縁に文字が掛かっていた（隣の欄を巻き込んだ疑い）。
 * drift=見出しから測った位置のズレ。
 */
export type AreaRefinement = { fieldId: string; text: string; confidence: number; clipped?: boolean };

/** 読み直した値で上書きする。読めなかった枠は1段目の結果を残す */
/** これを下回った読み直しは「確認してから使う」値にする（黙って日報へ入れない） */
export const REFINEMENT_MIN_CONFIDENCE = 0.6;

export function applyRefinements(
  template: ImageTemplate,
  reads: readonly FieldRead[],
  refinements: readonly AreaRefinement[],
  options: { reportDate?: string | null } = {},
): FieldRead[] {
  return reads.map((read) => {
    const field = (template.definition.fields ?? []).find((f) => f.id === read.fieldId);
    const refinement = refinements.find((r) => r.fieldId === read.fieldId);
    if (!field || !refinement) return read;
    const value = parseValue(refinement.text, field.value, { referenceDate: options.reportDate ?? null });
    // 切り出して読んでも空なら「空欄」。1段目で読めた値を勝手に残さない
    if (value == null) {
      return read.refined ? read : { ...read, raw: refinement.text || read.raw, value: null, status: "not_found", refined: true };
    }
    const suspect =
      refinement.confidence < REFINEMENT_MIN_CONFIDENCE || refinement.clipped === true || read.status === "uncertain";
    return {
      ...read,
      raw: refinement.text,
      value,
      status: suspect ? "uncertain" : "read",
      confidence: refinement.confidence,
      refined: true,
    };
  });
}

/**
 * 機械が自分で答え合わせできたか。**「裏が取れない」と「怪しい」は別物**として扱う。
 *
 * verified … 表の中の関係が閉じていて、読み取りにも迷いが無い。人の確認は要らない
 * unproven … 悪い兆候は無いが、突き合わせる材料が無くて証明できない
 *            （画面に合計が無い・見出しが一部しか読めない など）。
 *            件数が報酬に効かないコースなら、設定で確認を省いてよい範囲
 * suspect  … **実際に食い違いがある**（合計が合わない／範囲外／裏付けの無い怪しい読み）。
 *            設定に関わらず人に見てもらう
 */
export type ReadTrust = {
  level: "verified" | "unproven" | "suspect";
  /** 実際に確かめられた式の本数。0本なら「確かめようがなかった」 */
  checksRun: number;
  checksFailed: number;
  /** 必須の項目が読めていない（人の入力が要る） */
  incomplete: boolean;
  /** 確認が要る理由（短く） */
  reasons: string[];
};

export type ReadResult = {
  match: TemplateMatchResult;
  fields: FieldRead[];
  /** 画像に書かれていた対象日（role=date の項目から読めたとき） */
  readDate: string | null;
  /** 検算の不一致や必須項目の未取得。自動では直さず、確認を促すためだけに使う */
  warnings: string[];
  trust: ReadTrust;
};

/** 範囲の検査と検算をして結果をまとめる。1段目だけでも2段目のあとでも同じものを通す */
export function completeRead(
  template: ImageTemplate,
  match: TemplateMatchResult,
  reads: readonly FieldRead[],
): ReadResult {
  const fields = reads.map((read) => {
    const field = (template.definition.fields ?? []).find((f) => f.id === read.fieldId);
    if (!field || read.status !== "read" || typeof read.value !== "number") return read;
    const { min, max } = field.value;
    if ((min != null && read.value < min) || (max != null && read.value > max)) {
      return { ...read, status: "out_of_range" as const };
    }
    return read;
  });

  const warnings: string[] = [];
  if (match.level === "low") {
    warnings.push("様式の見出しを一部しか確認できません。値が合っているか見てください");
  }
  if (match.missingRequired.length > 0) {
    warnings.push(`見出しが写っていません（${match.missingRequired.join("・")}）`);
  }
  for (const field of template.definition.fields ?? []) {
    const read = fields.find((f) => f.fieldId === field.id);
    if (!read) continue;
    if (field.required && (read.status === "no_anchor" || read.status === "not_found")) {
      warnings.push(`${field.label}を読み取れませんでした`);
    }
    if (read.status === "out_of_range" || read.status === "uncertain") {
      warnings.push(`${field.label}の値を確認してください`);
    }
  }
  // 検算が合わない＝どこかの欄を読み違えている。関係する項目をまとめて確認に回す
  const suspectIds = new Set<string>();
  /** 通った式に参加した項目＝別の欄の値と辻褄が合っている＝裏が取れた */
  const corroborated = new Set<string>();
  let checksRun = 0;
  let checksFailed = 0;
  for (const check of template.definition.checks ?? []) {
    const total = fields.find((f) => f.fieldId === check.totalFieldId);
    const parts = check.partFieldIds.map((id) => fields.find((f) => f.fieldId === id));
    if (!total || typeof total.value !== "number") continue;
    if (parts.some((p) => !p || typeof p.value !== "number")) continue;
    checksRun += 1;
    const sum = parts.reduce((acc, p) => acc + (p!.value as number), 0);
    if (sum !== total.value) {
      checksFailed += 1;
      warnings.push(`${total.label}（${total.value}）と内訳の合計（${sum}）が合いません`);
      suspectIds.add(total.fieldId);
      for (const part of parts) if (part) suspectIds.add(part.fieldId);
    } else {
      // 式が通っても、それだけでは裏付けにならない。
      // **ある項目の裏付けになるのは、残りの参加者が全部きれいに読めている式だけ。**
      // （読みに迷った値どうしで辻褄が合ってしまう事故を弾く）
      const participants = [total, ...(parts as FieldRead[])];
      for (const target of participants) {
        const others = participants.filter((p) => p.fieldId !== target.fieldId);
        if (others.every((p) => p.status === "read")) corroborated.add(target.fieldId);
      }
    }
  }
  const checked = fields.map((field) =>
    suspectIds.has(field.fieldId) && field.status === "read" ? { ...field, status: "uncertain" as const } : field,
  );

  const dateRead = checked.find((f) => f.role === "date");
  const readDate =
    dateRead && typeof dateRead.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateRead.value) ? dateRead.value : null;

  // 人に確認してもらうかどうかを決める。
  // 「式が1本以上通っていて、全部閉じていて、読めない欄も確度の低い欄も無い」ときだけ、
  // 画像と見比べる作業を省く。式が1本も無い様式では省かない（確かめようがないため）。
  const reasons: string[] = [];
  // 式が何本も通っているなら、見出しが1つ欠けていること自体は問題にしない
  // （合計の一致は、見出しの数より強い証拠になる）
  const arithmeticProof = checksRun >= 3 && checksFailed === 0;
  if (match.level !== "high" && !arithmeticProof) reasons.push("様式の見出しを一部しか確認できません");

  const entryFields = (template.definition.fields ?? []).filter((field) => (field.role ?? "entry") === "entry");
  const unread = entryFields.filter((field) => {
    if (!field.required) return false;
    const read = checked.find((f) => f.fieldId === field.id);
    return !read || read.value == null;
  });
  const incomplete = unread.length > 0;
  if (incomplete) reasons.push(`${unread.map((f) => f.label).join("・")}を読み取れていません`);

  // 読みに迷いがあっても、きれいに読めた値だけで組まれた式が通っていれば裏付けになる。
  // **日報へ入れない検算用の欄も見る**。表のどこかが読めていないなら、全体を信用しない
  const shaky = (template.definition.fields ?? []).filter((field) => {
    if ((field.role ?? "entry") === "date") return false;
    const read = checked.find((f) => f.fieldId === field.id);
    if (!read || read.value == null) return false;
    if (read.status === "out_of_range") return true;
    return read.status !== "read" && !corroborated.has(field.id);
  });
  if (shaky.length > 0) reasons.push(`${shaky.map((f) => f.label).join("・")}が確かめられていません`);

  if (checksFailed > 0) reasons.push("表の中の合計が合いません");
  if (checksRun === 0) reasons.push("表の中で突き合わせられる合計がありません");

  // 食い違いが実際にあるもの（＝設定でも省けない）
  const suspect =
    checksFailed > 0 || shaky.length > 0 || checked.some((field) => field.status === "out_of_range");
  const trust: ReadTrust = {
    level: suspect ? "suspect" : reasons.length === 0 ? "verified" : "unproven",
    checksRun,
    checksFailed,
    incomplete,
    reasons,
  };

  return { match, fields: checked, readDate, warnings, trust };
}

/**
 * 1枚を様式に沿って読む（1段目のOCRだけ）。
 * 表の数字は locateFields → 枠の切り出しOCR → applyRefinements の方が確実に読める。
 */
export function readWithTemplate(
  page: OcrPage,
  template: ImageTemplate,
  options: { reportDate?: string | null } = {},
): ReadResult {
  const located = locateFields(page, template);
  const reads = readAreas(page, template, located, options);
  return completeRead(template, located.match, reads);
}

// ------------------------------------------------------------
// 様式定義の検査（管理画面から保存する前に通す）
// ------------------------------------------------------------

const isBox = (value: unknown): value is Box => {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k] as number));
};

/**
 * 保存前の検査。空の見出し・項目の重複・壊れた座標を通さない。
 * allowEmpty=true は編集中の下書き用（見出しや項目がまだ無くても保存できる）。
 * 運用中にするときは allowEmpty を外して通す。
 */
export function validateTemplateDefinition(definition: unknown, options: { allowEmpty?: boolean } = {}): string[] {
  const errors: string[] = [];
  if (!definition || typeof definition !== "object") return ["様式の内容が不正です"];
  const def = definition as Partial<ImageTemplateDefinition>;

  const required = def.match?.required ?? [];
  if (!Array.isArray(required) || (required.length === 0 && !options.allowEmpty)) {
    errors.push("様式を見分ける見出しを1つ以上決めてください");
  }
  const checkAnchor = (anchor: unknown, where: string) => {
    if (!anchor || typeof anchor !== "object") return errors.push(`${where}の見出しが不正です`);
    const a = anchor as Partial<AnchorSpec>;
    if (typeof a.text !== "string" || a.text.trim() === "") errors.push(`${where}の見出しが空です`);
    if (typeof a.text === "string" && a.text.length > 40) errors.push(`${where}の見出しが長すぎます`);
    if (a.match !== "exact" && a.match !== "contains" && a.match !== "fuzzy") errors.push(`${where}の照合方法が不正です`);
    if (a.sampleBox != null && !isBox(a.sampleBox)) errors.push(`${where}の見本位置が不正です`);
    return undefined;
  };
  (Array.isArray(required) ? required : []).forEach((a, i) => checkAnchor(a, `必須の見出し${i + 1}`));
  (def.match?.optional ?? []).forEach((a, i) => checkAnchor(a, `任意の見出し${i + 1}`));

  const fields = def.fields ?? [];
  if (!Array.isArray(fields) || (fields.length === 0 && !options.allowEmpty)) {
    errors.push("読み取る項目を1つ以上決めてください");
  }
  const ids = new Set<string>();
  const bindings = new Set<string>();
  (Array.isArray(fields) ? fields : []).forEach((raw, index) => {
    const field = raw as Partial<TemplateField>;
    const where = field.label || `項目${index + 1}`;
    if (typeof field.id !== "string" || !field.id) errors.push(`${where}の識別子がありません`);
    else if (ids.has(field.id)) errors.push(`${where}の識別子が重複しています`);
    else ids.add(field.id);
    const role = field.role ?? "entry";
    if (role === "check") {
      // 検算専用の欄は日報項目へ結び付けない
    } else if (role === "entry") {
      if (!options.allowEmpty && (typeof field.unitId !== "string" || !field.unitId)) {
        errors.push(`${where}の報告単位を選んでください`);
      }
      if (!options.allowEmpty && (typeof field.fieldKey !== "string" || !field.fieldKey)) {
        errors.push(`${where}の報告項目を選んでください`);
      }
    } else if (role !== "date") {
      errors.push(`${where}の役割が不正です`);
    }
    if (role === "date" && field.value?.type !== "date") errors.push(`${where}は日付として読む設定にしてください`);
    if (role === "entry" && field.unitId && field.fieldKey) {
      const binding = `${field.unitId}:${field.fieldKey}`;
      // 同じ報告項目へ2か所から値を入れると、どちらが採用されたか分からなくなる
      if (bindings.has(binding)) errors.push(`${where}と同じ報告項目が二重に割り当てられています`);
      else bindings.add(binding);
    }
    const type = field.value?.type;
    if (type !== "int" && type !== "decimal" && type !== "time" && type !== "date") {
      errors.push(`${where}の値の種類が不正です`);
    }
    const locator = field.locator;
    if (!locator || typeof locator !== "object") return errors.push(`${where}の場所が決まっていません`);
    if (locator.kind === "anchor") {
      checkAnchor(locator.anchor, where);
      if (!["right", "left", "below", "above"].includes(locator.direction)) errors.push(`${where}の向きが不正です`);
    } else if (locator.kind === "cell") {
      checkAnchor(locator.row, `${where}の行見出し`);
      checkAnchor(locator.column, `${where}の列見出し`);
    } else if (locator.kind === "region") {
      if (!isBox(locator.rect)) errors.push(`${where}の範囲が不正です`);
      if (!def.sample) errors.push(`${where}は見本画像の範囲指定なので、見本画像を登録してください`);
    } else {
      errors.push(`${where}の場所の指定方法が不正です`);
    }
    return undefined;
  });

  for (const check of def.checks ?? []) {
    if (!ids.has(check.totalFieldId)) errors.push("検算の合計に存在しない項目が指定されています");
    if (check.partFieldIds.some((id) => !ids.has(id))) errors.push("検算の内訳に存在しない項目が指定されています");
  }
  return errors;
}

// ------------------------------------------------------------
// 「その日の稼働のスクショか」の照合
//
// 拒否の判断はしない。判断の材料（画像の作成日時・画像内の日付・過去の提出との一致）を
// 突き合わせて、本人と管理が確認すべき点だけを短く出す。
// スクショは作成日時を持たないことが多いので、材料が無いこと自体は異常ではない。
// ------------------------------------------------------------

/** none=初出 / same_submission=同じ提出の再送 / same_image=同じ日に同じ画像 / other_date=別日にも / other_driver=別人にも */
export type SourceImageDuplicate = "none" | "same_submission" | "same_image" | "other_date" | "other_driver";

export type SourceImageDayInput = {
  /** 日報の対象営業日（YYYY-MM-DD） */
  reportDate: string;
  /** 画像の作成日時。取れなかったら null */
  capturedAt: string | null;
  capturedAtSource: "exif" | "photo_library" | "unknown";
  /** 画像に書かれていた日付（OCR）。読めなければ null */
  readDate: string | null;
  duplicate: SourceImageDuplicate;
};

export type SourceImageDayJudgement = {
  /** ok=対象日の画像と一致 / unverified=手がかりが無い / check=食い違いがある */
  level: "ok" | "unverified" | "check";
  reasons: string[];
};

const JST_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", dateStyle: "short" });

/** ISO時刻を日本時間の日付（YYYY-MM-DD）にする */
export function toJstDate(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return JST_DATE.format(new Date(time));
}

const addDays = (date: string, days: number): string => {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return date;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
};

/** 人に見せる日付（YYYY-MM-DD を出さない・UI規約） */
const formatJp = (date: string): string => {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : date;
};

export function judgeSourceImageDay(input: SourceImageDayInput): SourceImageDayJudgement {
  const reasons: string[] = [];

  if (input.duplicate === "other_driver") reasons.push("同じ画像が別の人の提出にもあります");
  if (input.duplicate === "other_date") reasons.push("同じ画像が別の日の提出にもあります");
  if (input.duplicate === "same_image") reasons.push("同じ画像をこの日に二重に出しています");

  if (input.readDate && input.readDate !== input.reportDate) {
    reasons.push(`画像の日付は${formatJp(input.readDate)}です`);
  }

  const capturedDate = input.capturedAt ? toJstDate(input.capturedAt) : null;
  if (capturedDate && capturedDate !== input.reportDate) {
    // 当日夜から翌朝にかけて撮る運用があるので、翌日ぶんは食い違いにしない
    if (capturedDate !== addDays(input.reportDate, 1)) {
      reasons.push(`画像を作った日は${formatJp(capturedDate)}です`);
    }
  }

  if (reasons.length > 0) return { level: "check", reasons };
  // 日付の裏付けがどこからも取れない。スクショでは普通なので、食い違いとは扱わない
  if (!input.readDate && !capturedDate) return { level: "unverified", reasons };
  return { level: "ok", reasons };
}

// ------------------------------------------------------------
// 見本の上で欄を囲んだときに、手がかりになる見出しを選ぶ
//
// 表の欄は座標だけで指すと、相手の画面が変わったときに隣の欄を読む。
// 欄の左（行見出し）と上（列見出し）の文字を一緒に覚えておけば、
// 読むときに「その見出しが今どこにあるか」で欄を追い直せる。
//
// ただし**紛らわしい見出しは付けないほうが安全**。
//   - 数字（毎日変わる）
//   - 同じ語が他の場所にもある（「持戻」は「配完＋持戻」にも含まれる）
// これらは候補から外す。
// ------------------------------------------------------------

/** 見出しに使えない語か（数字・短すぎ・他と紛れる） */
function unusableAnchorText(text: string, all: readonly string[]): boolean {
  const key = normalizeForMatch(text);
  if (key.length < 2) return true;
  // 数字を含む語は日によって変わる。見出しにしない
  if (/[0-9]/.test(key)) return true;
  const appearances = all.filter((other) => normalizeForMatch(other).includes(key)).length;
  return appearances !== 1;
}

/**
 * 語を「欄1つぶんの見出し」にまとめる。行の中を間隔で区切る
 * （「計A｜配完入力｜計B」のように、表の見出しは欄ごとに離れて並ぶ）。
 */
export function clusterSampleWords(sampleWords: readonly SampleWord[]): { text: string; box: Box }[] {
  const words: OcrWord[] = sampleWords.map((word) => ({ text: word.text, ...word.box }));
  const unit = medianWordHeight(words) || 12;
  const clusters: { text: string; box: Box }[] = [];
  for (const line of buildLines(words)) {
    let group: OcrWord[] = [];
    const flush = () => {
      if (group.length === 0) return;
      clusters.push({ text: group.map((word) => word.text).join(""), box: boxOf(group) });
      group = [];
    };
    for (const word of line.words) {
      const previous = group[group.length - 1];
      if (previous && word.x - (previous.x + previous.w) > unit * 1.2) flush();
      group.push(word);
    }
    flush();
  }
  return clusters;
}

/** 見出しの元。読み直した見出し（labels）があればそれを、無ければ語をまとめたものを使う */
function anchorSources(sampleWords: readonly SampleWord[], labels?: readonly SampleWord[]): { text: string; box: Box }[] {
  if (labels && labels.length > 0) return labels.map((label) => ({ text: label.text, box: label.box }));
  return clusterSampleWords(sampleWords);
}

export type AnchorSuggestion = { column: AnchorSpec | null; row: AnchorSpec | null };

/**
 * 囲んだ欄をどう指すかを決める。
 *
 * - 表（欄の上に列見出しがある）… 見本の座標で指し、行・列の見出しでズレを直す
 * - 一覧（左に項目名があり、右に数字が並ぶ）… **見出しからの相対**で読む。
 *   一覧型は写真で撮ると遠近でゆがむので、座標で指すと隣の行を読む。見出しの隣を読む方が強い。
 */
export function suggestLocator(rect: Box, sampleWords: readonly SampleWord[], labels?: readonly SampleWord[]): FieldLocator {
  const { column, row } = suggestAnchors(rect, sampleWords, labels);
  if (!column && row?.sampleBox) {
    const gap = rect.x + rect.w - (row.sampleBox.x + row.sampleBox.w);
    const unit = Math.max(1, medianWordHeight(sampleWords.map((w) => ({ text: w.text, ...w.box }))));
    return {
      kind: "anchor",
      anchor: row,
      direction: "right",
      valueHint: rect,
      // 見本での距離に余裕を足す。行の高さより広げると隣の行を拾うので広げすぎない
      maxGap: Math.min(40, Math.max(4, Math.ceil((gap / unit) * 1.4))),
      lineTolerance: 1.5,
      pick: "nearest",
    };
  }
  return { kind: "region", rect, column, row };
}

/**
 * 見本の語から、その欄の「上にある見出し」と「左にある見出し」を選ぶ。
 * 選べなければ null（座標だけで読むが、別の守りが働く）。
 */
export function suggestAnchors(
  rect: Box,
  sampleWords: readonly SampleWord[],
  labels?: readonly SampleWord[],
): AnchorSuggestion {
  const clusters = anchorSources(sampleWords, labels);
  const texts = clusters.map((cluster) => cluster.text);
  const usable = clusters
    .map((cluster) => ({ line: { box: cluster.box } as OcrLine, text: cluster.text }))
    .filter((entry) => !unusableAnchorText(entry.text, texts));

  const overlapsX = (box: Box) => box.x < rect.x + rect.w && box.x + box.w > rect.x;
  const overlapsY = (box: Box) => box.y < rect.y + rect.h && box.y + box.h > rect.y;

  const column = usable
    .filter((entry) => entry.line.box.y + entry.line.box.h <= rect.y + rect.h * 0.3 && overlapsX(entry.line.box))
    .sort((a, b) => b.line.box.y - a.line.box.y)[0];
  const row = usable
    .filter((entry) => entry.line.box.x + entry.line.box.w <= rect.x + rect.w * 0.3 && overlapsY(entry.line.box))
    .sort((a, b) => b.line.box.x - a.line.box.x)[0];

  const spec = (entry: { line: OcrLine; text: string } | undefined): AnchorSpec | null =>
    entry ? { text: entry.text, match: "fuzzy", sampleBox: entry.line.box } : null;

  return { column: spec(column), row: spec(row) };
}

// ------------------------------------------------------------
// 傾きの推定
//
// スクショではなく「別の端末の画面を撮った写真」が来ることがある（郵便局の追跡件数確認など）。
// 数度の傾きでも、行の左端にある見出しと右端にある数字で高さが20〜30pxずれ、
// 「その行の値」を取り違える。読む前に画像を起こしておく。
//
// 行にまとめてから測ると、傾いた画像では行がばらけて測れない。
// **近くにある語どうしの角度の中央値**で測る（行のまとまりに依存しない）。
// ------------------------------------------------------------

/** 傾き（度）。時計回りが正。読み取り前にこのぶん戻す */
export function estimateSkewAngle(page: OcrPage): number {
  const unit = medianWordHeight(page.words);
  if (unit <= 0) return 0;
  const words = page.words.filter((word) => word.text.trim().length > 0);
  const angles: number[] = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      const a = words[i];
      const b = words[j];
      const dx = b.x + b.w / 2 - (a.x + a.w / 2);
      const dy = b.y + b.h / 2 - (a.y + a.h / 2);
      // 同じ行に並んでいそうな組だけを見る（離れすぎ・縦にずれすぎは除く）
      if (Math.abs(dx) < unit * 1.5 || Math.abs(dx) > unit * 40) continue;
      if (Math.abs(dy) > unit * 1.5) continue;
      angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
    }
  }
  if (angles.length < 8) return 0;
  const angle = median(angles);
  // 小さすぎる傾きは直さない（無駄に画像を作り直さない）。大きすぎる値は測り損ね
  if (!Number.isFinite(angle) || Math.abs(angle) < 0.8 || Math.abs(angle) > 12) return 0;
  // **ばらつきが大きい推定は使わない。**
  // 表のスクショは欄ごとに文字の高さが微妙に違い、傾いていないのに傾いて見える。
  // 本当に傾いた写真では、どの語の組も同じ角度で揃う
  const spread = median(angles.map((value) => Math.abs(value - angle)));
  if (spread > 0.8) return 0;
  return angle;
}

/**
 * 読み取った値を、本人の目視確認なしで日報へ入れてよいか。
 *
 * - 表の中の関係で裏が取れていれば、いつでも省いてよい（機械が証明している）
 * - 証明できないだけで食い違いが無いものは、**コースの設定**で省ける。
 *   件数が報酬に効かないコース（日当など）のための逃げ道
 * - 食い違いがあるもの・必須の欄が読めていないものは、設定に関わらず人に見てもらう
 */
export function canSkipReview(trust: ReadTrust, options: { courseAllowsSkip?: boolean } = {}): boolean {
  if (trust.incomplete) return false;
  if (trust.level === "suspect") return false;
  if (trust.level === "verified") return true;
  return options.courseAllowsSkip === true;
}

// ------------------------------------------------------------
// 見本を登録するときの向きの判定と、見出しの下ごしらえ
//
// 向きは「語の数」で決めてはいけない。横向きのまま読むとラテン文字の誤読が
// 大量に出て、語数だけなら正しい向きより多くなる（実際に起きた）。
// **日本語・数字として読めた語がどれだけあるか**で決める。
// ------------------------------------------------------------

const READABLE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆0-9０-９]+$/u;
const SYMBOL_HEAVY = /[@&{}\[\]~^|<>$%#*=+;:'"`]/;

/** 日本語か数字としてまともに読めた語か */
export function isReadableWord(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (SYMBOL_HEAVY.test(t)) return false;
  return READABLE.test(t.normalize("NFKC")) || /^[A-Za-z]{2,}$/.test(t);
}

/**
 * その向きで読んだ結果の「まともさ」。大きいほど正しい向きらしい。
 * 日本語・数字の語を数え、記号まみれの語は差し引く。
 */
export function orientationScore(words: readonly { text: string }[]): number {
  let score = 0;
  for (const word of words) {
    const t = word.text.trim();
    if (!t) continue;
    if (READABLE.test(t.normalize("NFKC"))) score += Math.min(4, t.length);
    else if (SYMBOL_HEAVY.test(t)) score -= 1;
  }
  return score;
}

/** 見出しの候補として見せてよい語か（記号まみれ・1文字・数字だけを外す） */
export function isAnchorCandidate(text: string): boolean {
  const key = normalizeForMatch(text);
  if (key.length < 2) return false;
  if (/^[0-9]+$/.test(key)) return false;
  if (SYMBOL_HEAVY.test(text)) return false;
  // 半分以上が日本語・英数でない語は誤読
  const good = (text.normalize("NFKC").match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ーA-Za-z0-9]/gu) ?? []).length;
  return good >= Math.ceil(text.length * 0.6);
}

/**
 * 様式を見分ける見出しを自動で選ぶ。上のほうにある、長めで一意な日本語を優先する。
 * 管理者が最初から3つ選ばなくても様式が成立するようにする（あとから変えられる）。
 */
export function suggestRequiredAnchors(
  sampleWords: readonly SampleWord[],
  limit = 3,
  labels?: readonly SampleWord[],
): AnchorSpec[] {
  const words: OcrWord[] = sampleWords.map((word) => ({ text: word.text, ...word.box }));
  const clusters = anchorSources(sampleWords, labels);
  const texts = clusters.map((c) => c.text);
  const usable = clusters.filter((cluster) => {
    if (!isAnchorCandidate(cluster.text)) return false;
    const key = normalizeForMatch(cluster.text);
    if (/[0-9]/.test(key)) return false;
    // 他の見出しに含まれる語・同じ語が2回出る語は見分けに使えない
    return texts.filter((other) => normalizeForMatch(other).includes(key)).length === 1;
  });
  const height = Math.max(1, ...words.map((w) => w.y + w.h));
  return usable
    .map((cluster) => ({
      cluster,
      // 長い日本語ほど、上にあるほど「その画面の題」らしい
      weight: Math.min(8, normalizeForMatch(cluster.text).length) * 2 - (cluster.box.y / height) * 4,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ cluster }) => ({ text: cluster.text, match: "fuzzy" as const, sampleBox: cluster.box }));
}
