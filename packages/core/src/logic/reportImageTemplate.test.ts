import { describe, expect, it } from "vitest";
import {
  applyRefinements,
  anchorTextMatches,
  buildLines,
  canSkipReview,
  chooseTemplate,
  completeRead,
  estimateSkewAngle,
  estimateTransformFromWords,
  isAnchorCandidate,
  judgeSourceImageDay,
  orientationScore,
  locateFields,
  MAX_SAFE_OUTLIER_RATE,
  parseValue,
  predictMissingAnchors,
  readAreas,
  readWithTemplate,
  resolveAnchor,
  suggestAnchors,
  suggestRequiredAnchors,
  validateTemplateDefinition,
  type ImageTemplate,
  type OcrPage,
  type OcrWord,
  type TemplateField as TemplateFieldForTest,
} from "./reportImageTemplate";

// ============================================================
// ヤマトの配達集計精算書（実サンプル 2026-09-19 で構造を確認）を模した盤面で、
// 画面サイズ違い・トリミング・見出しの欠けに耐えるかを見る。
// 実物の画像はリポジトリへ置かない（構造だけを写した合成データで検証する）。
// ============================================================

const w = (text: string, x: number, y: number, width = text.length * 20, height = 24): OcrWord => ({
  text,
  x,
  y,
  w: width,
  h: height,
  confidence: 0.9,
});

/** 行見出し×列見出しの表。空欄（配完入力不可）はあえて語を置かない */
function samplePage(): OcrPage {
  return {
    width: 1900,
    height: 870,
    words: [
      w("配達集計精算書", 690, 95),
      w("引渡実績", 500, 220),
      w("配達完了実績", 940, 220),
      w("計A", 520, 275),
      w("配完入力", 660, 275),
      w("計B", 1250, 275),
      w("持戻", 1440, 275),
      w("配完+持戻", 1600, 275),
      w("宅急便個数", 80, 365),
      w("46", 525, 375),
      w("44", 710, 375),
      w("44", 1260, 375),
      w("2", 1450, 375),
      w("46", 1640, 375),
      w("ネコポス個数", 80, 465),
      w("3", 530, 470),
      w("3", 715, 470),
      w("3", 1265, 470),
      w("0", 1455, 470),
      w("3", 1645, 470),
      w("合計", 80, 560),
      w("49", 525, 565),
      w("47", 710, 565),
      w("47", 1260, 565),
      w("2", 1450, 565),
      w("49", 1640, 565),
    ],
  };
}

const template: ImageTemplate = {
  key: "yamato-settlement",
  version: "1",
  name: "ヤマト 配達集計精算書",
  carrierId: null,
  definition: {
    match: {
      required: [
        { text: "配達集計精算書", match: "fuzzy", sampleBox: { x: 690, y: 95, w: 140, h: 24 } },
        { text: "ネコポス個数", match: "fuzzy", sampleBox: { x: 80, y: 465, w: 120, h: 24 } },
      ],
      optional: [{ text: "配達完了実績", match: "fuzzy" }],
      minScore: 0.6,
    },
    sample: { width: 1900, height: 870, unitHeight: 24 },
    fields: [
      {
        id: "takkyubin-done",
        unitId: "unit-takkyubin",
        fieldKey: "completed",
        label: "宅急便 配完",
        value: { type: "int", min: 0, max: 999 },
        locator: { kind: "cell", row: { text: "宅急便個数", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
        required: true,
      },
      {
        id: "takkyubin-return",
        unitId: "unit-takkyubin",
        fieldKey: "returned",
        label: "宅急便 持戻",
        value: { type: "int", min: 0, max: 999 },
        locator: { kind: "cell", row: { text: "宅急便個数", match: "fuzzy" }, column: { text: "持戻", match: "fuzzy" } },
        required: true,
      },
      {
        id: "nekopos-done",
        unitId: "unit-nekopos",
        fieldKey: "completed",
        label: "ネコポス 配完",
        value: { type: "int", min: 0, max: 999 },
        locator: { kind: "cell", row: { text: "ネコポス個数", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
        required: true,
      },
      {
        id: "nekopos-blocked",
        unitId: "unit-nekopos",
        fieldKey: "blocked",
        label: "ネコポス 配完入力不可",
        value: { type: "int", min: 0, max: 999 },
        // 空欄の列。0で埋めないことを確かめる
        locator: { kind: "region", rect: { x: 850, y: 455, w: 120, h: 44 } },
        required: false,
      },
    ],
    checks: [{ kind: "sum", totalFieldId: "takkyubin-done", partFieldIds: ["nekopos-done"] }],
  },
};

/** 画面サイズ違い・トリミングを再現する */
const transformPage = (page: OcrPage, scale: number, dx: number, dy: number): OcrPage => ({
  width: page.width * scale + dx,
  height: page.height * scale + dy,
  words: page.words.map((word) => ({
    ...word,
    x: word.x * scale + dx,
    y: word.y * scale + dy,
    w: word.w * scale,
    h: word.h * scale,
  })),
});

const valueOf = (result: ReturnType<typeof readWithTemplate>, id: string) =>
  result.fields.find((f) => f.fieldId === id);

describe("様式の判定", () => {
  it("見本どおりの画像は様式に一致する", () => {
    const choice = chooseTemplate(samplePage(), [template]);
    expect(choice.best?.templateKey).toBe("yamato-settlement");
    expect(choice.best?.score).toBeGreaterThan(0.9);
  });

  it("別の画面のスクショは採用しない（未対応として手入力へ戻す）", () => {
    const other: OcrPage = {
      width: 1200,
      height: 800,
      words: [w("ホーム", 40, 40), w("荷物の受付", 40, 120), w("12", 300, 120)],
    };
    const choice = chooseTemplate(other, [template]);
    expect(choice.best).toBeNull();
    expect(choice.ranked[0].accepted).toBe(false);
  });

  it("OCRが見出しを分けて返しても1つの見出しとして照合する", () => {
    const split: OcrPage = {
      ...samplePage(),
      words: [
        ...samplePage().words.filter((word) => word.text !== "配達集計精算書"),
        w("配達", 690, 95, 40),
        w("集計", 732, 95, 40),
        w("精算書", 774, 95, 60),
      ],
    };
    const lines = buildLines(split.words);
    expect(lines.some((line) => line.text.includes("配達集計精算書"))).toBe(true);
    expect(chooseTemplate(split, [template]).best).not.toBeNull();
  });
});

describe("値の読み取り", () => {
  it("行見出し×列見出しの交点を読む", () => {
    const result = readWithTemplate(samplePage(), template);
    expect(valueOf(result, "takkyubin-done")?.value).toBe(44);
    expect(valueOf(result, "takkyubin-return")?.value).toBe(2);
    expect(valueOf(result, "nekopos-done")?.value).toBe(3);
  });

  it("空欄は0ではなく未取得にする", () => {
    const result = readWithTemplate(samplePage(), template);
    const blocked = valueOf(result, "nekopos-blocked");
    expect(blocked?.value).toBeNull();
    expect(blocked?.status).toBe("not_found");
  });

  it("画面サイズが違っても同じ値を読む", () => {
    const result = readWithTemplate(transformPage(samplePage(), 1.75, 0, 0), template);
    expect(valueOf(result, "takkyubin-done")?.value).toBe(44);
    expect(valueOf(result, "takkyubin-return")?.value).toBe(2);
    expect(valueOf(result, "nekopos-done")?.value).toBe(3);
  });

  it("トリミングで位置がずれても同じ値を読む", () => {
    const result = readWithTemplate(transformPage(samplePage(), 1, -60, -180), template);
    expect(valueOf(result, "takkyubin-done")?.value).toBe(44);
    expect(valueOf(result, "nekopos-done")?.value).toBe(3);
  });

  it("見出しが切れた項目は未取得にし、0で埋めない", () => {
    const cropped: OcrPage = {
      ...samplePage(),
      words: samplePage().words.filter((word) => word.text !== "持戻"),
    };
    const result = readWithTemplate(cropped, template);
    const cut = valueOf(result, "takkyubin-return");
    expect(cut?.value).toBeNull();
    expect(cut?.status).toBe("no_anchor");
    expect(result.warnings.join()).toContain("宅急便 持戻");
  });

  it("範囲の外の値は要確認にする", () => {
    const strict: ImageTemplate = {
      ...template,
      definition: {
        ...template.definition,
        fields: template.definition.fields.map((field) =>
          field.id === "takkyubin-done" ? { ...field, value: { type: "int" as const, min: 0, max: 10 } } : field,
        ),
      },
    };
    const result = readWithTemplate(samplePage(), strict);
    expect(valueOf(result, "takkyubin-done")?.status).toBe("out_of_range");
  });

  it("検算が合わなければ警告を出す（値は書き換えない）", () => {
    const result = readWithTemplate(samplePage(), template);
    expect(result.warnings.some((warning) => warning.includes("合いません"))).toBe(true);
    expect(valueOf(result, "takkyubin-done")?.value).toBe(44);
  });
});

describe("枠を切り出して読み直す（2段目）", () => {
  it("切り出したOCRの値で上書きし、出どころの枠を残す", () => {
    const located = locateFields(samplePage(), template);
    const first = readAreas(samplePage(), template, located);
    const refined = applyRefinements(template, first, [
      { fieldId: "takkyubin-done", text: "44", confidence: 0.96 },
      { fieldId: "takkyubin-return", text: "2", confidence: 0.97 },
    ]);
    const result = completeRead(template, located.match, refined);
    expect(valueOf(result, "takkyubin-done")?.confidence).toBeCloseTo(0.96);
    expect(valueOf(result, "takkyubin-done")?.refined).toBe(true);
    expect(valueOf(result, "takkyubin-done")?.box).not.toBeNull();
  });

  it("切り出しても読めなければ未取得のままにする", () => {
    const located = locateFields(samplePage(), template);
    const first = readAreas(samplePage(), template, located);
    const refined = applyRefinements(template, first, [{ fieldId: "nekopos-blocked", text: "", confidence: 0 }]);
    expect(refined.find((f) => f.fieldId === "nekopos-blocked")?.value).toBeNull();
  });
});

describe("値の解釈", () => {
  it("単位や区切りが付いていても数値にする", () => {
    expect(parseValue("1,234個", { type: "int" })).toBe(1234);
    expect(parseValue("４４", { type: "int" })).toBe(44);
    expect(parseValue("", { type: "int" })).toBeNull();
    expect(parseValue("—", { type: "int" })).toBeNull();
  });

  it("日付は基準日に近い年で解釈する（年またぎを取り違えない）", () => {
    expect(parseValue("2026/9/19", { type: "date" })).toBe("2026-09-19");
    expect(parseValue("12月31日", { type: "date" }, { referenceDate: "2026-01-02" })).toBe("2025-12-31");
    expect(parseValue("2月30日", { type: "date" }, { referenceDate: "2026-03-01" })).toBeNull();
  });
});

describe("その日の稼働のスクショかの照合", () => {
  const base = {
    reportDate: "2026-09-19",
    capturedAt: null,
    capturedAtSource: "unknown" as const,
    readDate: null,
    duplicate: "none" as const,
  };

  it("手がかりが無いときは食い違い扱いにしない", () => {
    expect(judgeSourceImageDay(base).level).toBe("unverified");
  });

  it("画像の日付が対象日と違えば確認を促す", () => {
    const judged = judgeSourceImageDay({ ...base, readDate: "2026-09-18" });
    expect(judged.level).toBe("check");
    expect(judged.reasons.join()).toContain("9月18日");
  });

  it("過去に別の日・別の人が出した画像は確認を促す", () => {
    expect(judgeSourceImageDay({ ...base, duplicate: "other_date" }).level).toBe("check");
    expect(judgeSourceImageDay({ ...base, duplicate: "other_driver" }).reasons.join()).toContain("別の人");
  });

  it("対象日の夜に作った画像はそのまま通す", () => {
    const judged = judgeSourceImageDay({
      ...base,
      capturedAt: "2026-09-19T10:58:00.000Z", // JST 19:58
      capturedAtSource: "exif",
    });
    expect(judged.level).toBe("ok");
  });

  it("翌朝に作った画像は食い違いにしない（当日ぶんの提出）", () => {
    const judged = judgeSourceImageDay({
      ...base,
      capturedAt: "2026-09-19T22:30:00.000Z", // JST 翌日 7:30
      capturedAtSource: "exif",
    });
    expect(judged.level).toBe("ok");
  });
});

describe("様式定義の検査", () => {
  it("正しい定義は通す", () => {
    expect(validateTemplateDefinition(template.definition)).toEqual([]);
  });

  it("同じ報告項目へ二重に割り当てたら止める", () => {
    const broken = {
      ...template.definition,
      fields: template.definition.fields.map((field) =>
        field.id === "nekopos-done" ? { ...field, unitId: "unit-takkyubin", fieldKey: "completed" } : field,
      ),
    };
    expect(validateTemplateDefinition(broken).join()).toContain("二重");
  });

  it("見分ける見出しが無ければ止める", () => {
    expect(validateTemplateDefinition({ ...template.definition, match: { required: [] } }).join()).toContain("見出し");
  });
});

// ============================================================
// 数字が並ぶ表で「隣の欄の数字を、正しそうな顔で入れてしまう」ことへの防御。
// OCRの確度は字が読めたかしか見ておらず、場所の正しさは保証しない。
// ============================================================
describe("隣の欄を読んでしまわないか", () => {
  /** 列見出しを手がかりに欄を指す様式（座標だけに頼らない） */
  const anchored: ImageTemplate = {
    ...template,
    definition: {
      ...template.definition,
      fields: [
        {
          id: "done",
          unitId: "unit-takkyubin",
          fieldKey: "completed",
          label: "宅急便 配完",
          value: { type: "int", min: 0, max: 999 },
          locator: {
            kind: "region",
            rect: { x: 1230, y: 355, w: 120, h: 45 },
            // 見本でその見出しがあった場所を持たせる（差分で欄を動かすため）
            column: { text: "計B", match: "fuzzy", sampleBox: { x: 1250, y: 275, w: 40, h: 24 } },
            row: { text: "宅急便個数", match: "fuzzy", sampleBox: { x: 80, y: 365, w: 100, h: 24 } },
          },
          required: true,
        },
      ],
      checks: [],
    },
  };

  it("列が1つ増えて表がずれても、見出しを追って正しい欄を読む", () => {
    // 相手の画面に列が増え、計B から右が 190px ずれた場合
    const shifted: OcrPage = {
      ...samplePage(),
      words: samplePage().words.map((word) =>
        word.x >= 1240 ? { ...word, x: word.x + 190 } : word,
      ),
    };
    const result = readWithTemplate(shifted, anchored);
    const read = valueOf(result, "done");
    // 見出しを追うので値は正しい。ただし「ずれた」ので確認に回す
    expect(read?.value).toBe(44);
    expect(read?.status).toBe("uncertain");
  });

  it("列見出しが読めない様式でも、行見出しと座標で読む（実画像の配完表がこれ）", () => {
    const noHeader: OcrPage = {
      ...samplePage(),
      words: samplePage().words.filter((word) => word.text !== "計B"),
    };
    const read = valueOf(readWithTemplate(noHeader, anchored), "done");
    expect(read?.value).toBe(44);
    expect(read?.status).toBe("read");
  });

  it("表の作りが変わっていれば、座標で指した欄は確認に回す", () => {
    // 見本の語を持たせると、当てはまり具合で作りの変化を見つけられる。
    // 座標で欄を指す様式（列見出しが読めない表はこうなる）が対象
    const withSample: ImageTemplate = {
      ...template,
      definition: {
        ...template.definition,
        checks: [],
        fields: [
          {
            id: "done",
            unitId: "unit-takkyubin",
            fieldKey: "completed",
            label: "宅急便 配完",
            value: { type: "int", min: 0, max: 999 },
            locator: { kind: "region", rect: { x: 1230, y: 355, w: 120, h: 45 } },
            required: true,
          },
        ],
        sample: {
          width: 1900,
          height: 870,
          unitHeight: 24,
          words: samplePage().words.map((word) => ({
            text: word.text,
            box: { x: word.x, y: word.y, w: word.w, h: word.h },
          })),
        },
      },
    };
    // 右半分だけが左へ寄った＝列が1つ消えた場合。**隣の列の数字が、狙っていた欄の位置に来る**
    // （この様式では 持戻の「2」が 計B の位置に入る）。ここで 2 を配完として入れたら事故になる
    const restructured: OcrPage = {
      ...samplePage(),
      words: samplePage().words.map((word) => (word.x >= 1240 ? { ...word, x: word.x - 190 } : word)),
    };
    const located = locateFields(restructured, withSample);
    expect(located.fit.outlierRate ?? 0).toBeGreaterThan(MAX_SAFE_OUTLIER_RATE);

    const result = readWithTemplate(restructured, withSample);
    const read = valueOf(result, "done");
    // 値そのものは隣の欄のものになりうる。だから「読めた」とは言わせない
    expect(read?.status).toBe("uncertain");

    // 拡大しただけの画像は確認に回さない（普通の提出を疑わない）
    const scaled = readWithTemplate(transformPage(samplePage(), 1.4, 0, 0), withSample);
    expect(valueOf(scaled, "done")?.status).toBe("read");
    expect(valueOf(scaled, "done")?.value).toBe(44);
  });

  it("欄の端に寄った数字は、隣から拾った疑いとして確認に回す", () => {
    const edge: ImageTemplate = {
      ...template,
      definition: {
        ...template.definition,
        checks: [],
        fields: [
          {
            ...(anchored.definition.fields[0] as TemplateFieldForTest),
            locator: { kind: "region", rect: { x: 1150, y: 355, w: 200, h: 45 } },
          },
        ],
      },
    };
    // 欄の右端すれすれに数字がある＝本来は隣の欄のもの
    const page: OcrPage = {
      ...samplePage(),
      words: [...samplePage().words.filter((w) => w.x !== 1260), w("44", 1320, 375)],
    };
    expect(valueOf(readWithTemplate(page, edge), "done")?.status).toBe("uncertain");
  });

  it("検算が合わなければ、関係する項目をまとめて確認に回す", () => {
    const withCheck: ImageTemplate = {
      ...template,
      definition: {
        ...template.definition,
        checks: [{ kind: "sum", totalFieldId: "takkyubin-done", partFieldIds: ["nekopos-done"] }],
      },
    };
    const result = readWithTemplate(samplePage(), withCheck);
    // 44 ≠ 3 なので、両方を確認に回す（値は書き換えない）
    expect(valueOf(result, "takkyubin-done")?.status).toBe("uncertain");
    expect(valueOf(result, "nekopos-done")?.status).toBe("uncertain");
    expect(valueOf(result, "takkyubin-done")?.value).toBe(44);
  });

  it("切り出しの縁に文字が掛かっていた読み直しは信じない", () => {
    const located = locateFields(samplePage(), template);
    const first = readAreas(samplePage(), template, located);
    const refined = applyRefinements(template, first, [
      { fieldId: "takkyubin-done", text: "444", confidence: 0.95, clipped: true },
    ]);
    const read = refined.find((f) => f.fieldId === "takkyubin-done");
    expect(read?.status).toBe("uncertain");
    expect(read?.value).toBe(444);
  });
});

describe("欄を囲んだときの見出しの提案", () => {
  const sampleWords = () =>
    samplePage().words.map((word) => ({ text: word.text, box: { x: word.x, y: word.y, w: word.w, h: word.h } }));

  it("欄の上と左にある見出しを選ぶ", () => {
    // 計B × 宅急便個数 の欄
    const suggestion = suggestAnchors({ x: 1230, y: 355, w: 120, h: 45 }, sampleWords());
    expect(suggestion.column?.text).toBe("計B");
    expect(suggestion.row?.text).toBe("宅急便個数");
    expect(suggestion.column?.sampleBox).toBeTruthy();
  });

  it("数字は見出しにしない（日によって変わるため）", () => {
    const suggestion = suggestAnchors({ x: 1420, y: 450, w: 120, h: 45 }, sampleWords());
    expect(suggestion.column?.text ?? "").not.toMatch(/\d/);
    expect(suggestion.row?.text ?? "").not.toMatch(/\d/);
  });

  it("他の見出しに含まれてしまう語は選ばない", () => {
    // 「持戻」は「配完+持戻」にも含まれる。これを列見出しにすると隣の列を読む
    const suggestion = suggestAnchors({ x: 1420, y: 355, w: 120, h: 45 }, sampleWords());
    expect(suggestion.column?.text).not.toBe("持戻");
  });
});

// ============================================================
// 機械が自分で答え合わせできたか。
// 表の中の関係が閉じていれば、人が毎回画像と見比べる必要はない。
// ============================================================
describe("機械の答え合わせ", () => {
  /** 合計＝宅急便＋ネコポス（実際の表の関係と同じ形） */
  const withChecks = (checks: { kind: "sum"; totalFieldId: string; partFieldIds: string[] }[]): ImageTemplate => ({
    ...template,
    definition: {
      ...template.definition,
      checks,
      fields: [
        {
          id: "takkyubin-done",
          unitId: "unit-takkyubin",
          fieldKey: "completed",
          label: "宅急便 配完",
          value: { type: "int" },
          locator: { kind: "cell", row: { text: "宅急便個数", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
          required: true,
        },
        {
          id: "nekopos-done",
          unitId: "unit-nekopos",
          fieldKey: "completed",
          label: "ネコポス 配完",
          value: { type: "int" },
          locator: { kind: "cell", row: { text: "ネコポス個数", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
          required: true,
        },
        {
          id: "total-done",
          role: "check",
          unitId: "",
          fieldKey: "",
          label: "合計 配完",
          value: { type: "int" },
          locator: { kind: "cell", row: { text: "合計", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
          required: false,
        },
      ],
    },
  });

  const sumCheck = [{ kind: "sum" as const, totalFieldId: "total-done", partFieldIds: ["takkyubin-done", "nekopos-done"] }];

  it("表の合計が合えば、画像と見比べずに確定してよい", () => {
    const result = readWithTemplate(samplePage(), withChecks(sumCheck));
    // 44 + 3 = 47
    expect(result.trust.level).toBe("verified");
    expect(result.trust.checksRun).toBe(1);
    expect(result.trust.reasons).toEqual([]);
  });

  it("突き合わせる式が無い様式では確定を省かない", () => {
    const result = readWithTemplate(samplePage(), withChecks([]));
    expect(result.trust.level).toBe("unproven");
    expect(result.trust.reasons.join()).toContain("突き合わせられる合計がありません");
  });

  it("合計が合わなければ人に見てもらう", () => {
    const broken: OcrPage = {
      ...samplePage(),
      // 合計の欄だけ違う数字にする（＝どこかを読み違えている）
      words: samplePage().words.map((word) => (word.x === 1260 && word.y === 565 ? { ...word, text: "99" } : word)),
    };
    const result = readWithTemplate(broken, withChecks(sumCheck));
    expect(result.trust.level).toBe("suspect");
    expect(result.trust.checksFailed).toBe(1);
  });

  it("読みに迷った値でも、きれいに読めた値だけの式が裏付ければ確定してよい", () => {
    const template2 = withChecks(sumCheck);
    const located = locateFields(samplePage(), template2);
    const first = readAreas(samplePage(), template2, located);
    // 宅急便だけ確度が低い。ほかはきれいに読めている
    const refined = applyRefinements(template2, first, [
      { fieldId: "takkyubin-done", text: "44", confidence: 0.4 },
      { fieldId: "nekopos-done", text: "3", confidence: 0.95 },
      { fieldId: "total-done", text: "47", confidence: 0.95 },
    ]);
    const result = completeRead(template2, located.match, refined);
    expect(result.trust.level).toBe("verified");
  });

  it("迷った値どうしで辻褄が合っても、裏付けとは認めない", () => {
    const template2 = withChecks(sumCheck);
    const located = locateFields(samplePage(), template2);
    const first = readAreas(samplePage(), template2, located);
    // 宅急便と合計の両方が怪しい。式は通るが、それは同じ誤りが揃っただけかもしれない
    const refined = applyRefinements(template2, first, [
      { fieldId: "takkyubin-done", text: "4", confidence: 0.4 },
      { fieldId: "nekopos-done", text: "3", confidence: 0.95 },
      { fieldId: "total-done", text: "7", confidence: 0.4 },
    ]);
    const result = completeRead(template2, located.match, refined);
    expect(result.trust.level).toBe("suspect");
    expect(result.trust.reasons.join()).toContain("確かめられていません");
  });
});

describe("数字だけの欄の読み替え", () => {
  it("単独の0が O や U と読まれても数字に戻す", () => {
    expect(parseValue("U", { type: "int" })).toBe(0);
    expect(parseValue("O", { type: "int" })).toBe(0);
    expect(parseValue("l", { type: "int" })).toBe(1);
  });

  it("数字が混ざっていればそのまま読む", () => {
    expect(parseValue("106通", { type: "int" })).toBe(106);
    expect(parseValue("1O6", { type: "int" })).toBe(1);
  });

  it("文章は数字にしない", () => {
    expect(parseValue("配達完了", { type: "int" })).toBeNull();
    expect(parseValue("abcd", { type: "int" })).toBeNull();
  });
});

describe("傾きの推定", () => {
  const grid = (skewDeg: number): OcrPage => {
    const words: OcrWord[] = [];
    const rad = (skewDeg * Math.PI) / 180;
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const x = 100 + col * 220;
        const y = 200 + row * 90;
        words.push({ text: `w${row}${col}`, x, y: y + Math.tan(rad) * x, w: 60, h: 24 });
      }
    }
    return { width: 1400, height: 900, words };
  };

  it("傾いた写真の角度を測る", () => {
    expect(estimateSkewAngle(grid(2))).toBeGreaterThan(1.5);
    expect(estimateSkewAngle(grid(2))).toBeLessThan(2.5);
  });

  it("傾いていない画面は直さない", () => {
    expect(estimateSkewAngle(grid(0))).toBe(0);
  });

  it("ばらついた推定は使わない（表のスクショを傾いていると誤らない）", () => {
    const noisy = grid(0);
    const jittered: OcrPage = {
      ...noisy,
      words: noisy.words.map((word, index) => ({ ...word, y: word.y + (index % 3) * 14 })),
    };
    expect(estimateSkewAngle(jittered)).toBe(0);
  });
});

describe("目視確認を省いてよいか", () => {
  const trust = (over: Partial<import("./reportImageTemplate").ReadTrust> = {}) => ({
    level: "verified" as const,
    checksRun: 3,
    checksFailed: 0,
    incomplete: false,
    reasons: [],
    ...over,
  });

  it("裏が取れていれば設定に関わらず省ける", () => {
    expect(canSkipReview(trust())).toBe(true);
  });

  it("証明できないだけなら、コースの設定で省ける", () => {
    const unproven = trust({ level: "unproven", checksRun: 0, reasons: ["表の中で突き合わせられる合計がありません"] });
    expect(canSkipReview(unproven)).toBe(false);
    expect(canSkipReview(unproven, { courseAllowsSkip: true })).toBe(true);
  });

  it("食い違いがあるものは設定でも省けない", () => {
    const suspect = trust({ level: "suspect", checksFailed: 1 });
    expect(canSkipReview(suspect, { courseAllowsSkip: true })).toBe(false);
  });

  it("必須の欄が読めていなければ省けない（人の入力が要る）", () => {
    expect(canSkipReview(trust({ incomplete: true }), { courseAllowsSkip: true })).toBe(false);
  });
});

describe("見本の向きと見出しの下ごしらえ", () => {
  it("横向きの誤読は語が多くても点が低い", () => {
    const upright = [{ text: "配達集計精算書" }, { text: "ネコポス個数" }, { text: "44" }, { text: "2" }];
    const sideways = [{ text: "19:5856@&D" }, { text: "Hafk" }, { text: "orf" }, { text: "Eo" }, { text: "{ik" }, { text: "KR~~" }, { text: "aN" }];
    expect(orientationScore(upright)).toBeGreaterThan(orientationScore(sideways));
  });

  it("記号まみれの語は見出し候補にしない", () => {
    expect(isAnchorCandidate("19:5856@&D")).toBe(false);
    expect(isAnchorCandidate("{ik")).toBe(false);
    expect(isAnchorCandidate("配達集計精算書")).toBe(true);
    expect(isAnchorCandidate("B+C")).toBe(false);
  });

  it("様式を見分ける見出しを、上にある長い日本語から選ぶ", () => {
    const words = samplePage().words.map((w) => ({ text: w.text, box: { x: w.x, y: w.y, w: w.w, h: w.h } }));
    const picked = suggestRequiredAnchors(words);
    expect(picked.map((a) => a.text)).toContain("配達集計精算書");
    expect(picked.every((a) => !/[0-9]/.test(a.text))).toBe(true);
    expect(picked.every((a) => a.sampleBox)).toBe(true);
  });
});

describe("見出しの候補の絞り込み（崩れを通さない）", () => {
  it("日本語と英字が混ざった崩れは通さない", () => {
    expect(isAnchorCandidate("osトシMeメメ")).toBe(false);
    expect(isAnchorCandidate("1トトES")).toBe(false);
  });

  it("日本語主体か、英字だけの語は通す", () => {
    expect(isAnchorCandidate("ネコポス個数")).toBe(true);
    expect(isAnchorCandidate("宅急便コンパクト")).toBe(true);
    expect(isAnchorCandidate("EAZY")).toBe(true);
    expect(isAnchorCandidate("計A")).toBe(false);
  });

  it("日報へ入る値が全部式で裏付けられていれば、見出しの欠けを理由に確認を求めない", () => {
    const withCheck: ImageTemplate = {
      ...template,
      definition: {
        ...template.definition,
        match: {
          ...template.definition.match,
          // 写らない見出しを必須に2つ入れてしまった様式（一致は「低」になる）
          required: [
            ...template.definition.match.required,
            { text: "存在しない見出し", match: "fuzzy" },
            { text: "これも無い見出し", match: "fuzzy" },
          ],
        },
        fields: [
          {
            id: "takkyubin-done",
            unitId: "unit-takkyubin",
            fieldKey: "completed",
            label: "宅急便 配完",
            value: { type: "int" },
            locator: { kind: "cell", row: { text: "宅急便個数", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
            required: true,
          },
          {
            id: "nekopos-done",
            unitId: "unit-nekopos",
            fieldKey: "completed",
            label: "ネコポス 配完",
            value: { type: "int" },
            locator: { kind: "cell", row: { text: "ネコポス個数", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
            required: true,
          },
          {
            id: "total-done",
            role: "check",
            unitId: "",
            fieldKey: "",
            label: "合計 配完",
            value: { type: "int" },
            locator: { kind: "cell", row: { text: "合計", match: "fuzzy" }, column: { text: "計B", match: "fuzzy" } },
            required: false,
          },
        ],
        checks: [{ kind: "sum", totalFieldId: "total-done", partFieldIds: ["takkyubin-done", "nekopos-done"] }],
      },
    };
    const result = readWithTemplate(samplePage(), withCheck);
    expect(result.match.level).toBe("low");
    expect(result.trust.level).toBe("verified");
  });
});

describe("見つからない見出しの探し直し", () => {
  it("見本での位置を持つ見出しが1段目に無ければ、あるはずの場所を返す", () => {
    const missingRow: OcrPage = {
      ...samplePage(),
      words: samplePage().words.map((word) => (word.text === "ネコポス個数" ? { ...word, text: "ホス人数" } : word)),
    };
    const missing = predictMissingAnchors(missingRow, template);
    expect(missing.map((m) => m.spec.text)).toContain("ネコポス個数");
    const box = missing.find((m) => m.spec.text === "ネコポス個数")!.box;
    // 本来の位置（x=80, y=465）を含む
    expect(box.x).toBeLessThan(80);
    expect(box.x + box.w).toBeGreaterThan(200);
    expect(box.y).toBeLessThan(465);
    expect(box.y + box.h).toBeGreaterThan(489);
  });

  it("1段目で見つかっている見出しは探し直さない", () => {
    expect(predictMissingAnchors(samplePage(), template).map((m) => m.spec.text)).not.toContain("配達集計精算書");
  });

  it("読み直した文字が見出しと言えるかは、あいまい一致で判定する", () => {
    const spec = { text: "ネコポス個数", match: "fuzzy" as const };
    expect(anchorTextMatches(spec, "ネコボス個数")).toBe(true);
    expect(anchorTextMatches(spec, "ホス人数")).toBe(false);
    expect(anchorTextMatches({ text: "合計", match: "fuzzy" }, "合計 49")).toBe(true);
  });

  it("位置合わせの対応点に数字を使わない（日によって変わる）", () => {
    const sample = samplePage().words.map((w) => ({ text: w.text, box: { x: w.x, y: w.y, w: w.w, h: w.h } }));
    // 別の日: 数字は全部違う位置・値になっているが、見出しは同じ
    const anotherDay: OcrPage = {
      ...samplePage(),
      words: samplePage().words.map((word) => (/^\d+$/.test(word.text) ? { ...word, text: String(Number(word.text) + 7), x: word.x + 300 } : word)),
    };
    const fit = estimateTransformFromWords(sample, anotherDay, { scaleX: 1, scaleY: 1, dx: 0, dy: 0 });
    expect(Math.abs(fit.transform.dx)).toBeLessThan(5);
    expect(fit.outlierRate ?? 0).toBe(0);
  });
});

describe("式の矛盾の扱い", () => {
  /** 宅急便・ネコポス・合計 × 計B と 配完+持戻 の表。式: 合計=宅急便+ネコポス（2列） */
  const grid = (): ImageTemplate => ({
    ...template,
    definition: {
      ...template.definition,
      checks: [
        { kind: "sum", totalFieldId: "total-b", partFieldIds: ["takkyubin-b", "nekopos-b"] },
        { kind: "sum", totalFieldId: "total-bc", partFieldIds: ["takkyubin-bc", "nekopos-bc"] },
      ],
      fields: (
        [
          ["takkyubin-b", "entry", "宅急便個数", "計B", "宅急便 配完"],
          ["nekopos-b", "entry", "ネコポス個数", "計B", "ネコポス 配完"],
          ["total-b", "check", "合計", "計B", "合計 配完"],
          ["takkyubin-bc", "check", "宅急便個数", "配完+持戻", "宅急便 B+C"],
          ["nekopos-bc", "check", "ネコポス個数", "配完+持戻", "ネコポス B+C"],
          ["total-bc", "check", "合計", "配完+持戻", "合計 B+C"],
        ] as const
      ).map(([id, role, row, column, label]) => ({
        id,
        role,
        unitId: role === "entry" ? "unit-x" : "",
        fieldKey: role === "entry" ? "completed" : "",
        label,
        value: { type: "int" as const },
        locator: { kind: "cell" as const, row: { text: row, match: "fuzzy" as const }, column: { text: column, match: "fuzzy" as const } },
        required: role === "entry",
      })),
    },
  });

  it("検算専用の1欄を読み違えても、日報へ入る値が他の式で裏付けられていれば確定してよい", () => {
    // 合計 B+C（49）だけ 99 に誤読 → 合計=宅急便+ネコポス（B+C列）と、その欄が関わる式が崩れる
    const page: OcrPage = {
      ...samplePage(),
      words: samplePage().words.map((w) => (w.x === 1640 && w.y === 565 ? { ...w, text: "99" } : w)),
    };
    const result = readWithTemplate(page, grid());
    expect(result.trust.checksFailed).toBe(1);
    expect(result.trust.level).toBe("verified");
    // 疑わしいのは誤読した欄だけ
    expect(valueOf(result, "total-bc")?.status).toBe("uncertain");
    expect(valueOf(result, "takkyubin-b")?.status).toBe("read");
    expect(result.warnings.join()).toContain("合計 B+C");
  });

  it("日報へ入る値そのものが崩れた式にしか出てこなければ、確認を求める", () => {
    // 宅急便 計B（44）を 40 に誤読 → 合計=宅急便+ネコポス と 宅急便 B+C=計B が両方崩れ、裏付けが無い
    const page: OcrPage = {
      ...samplePage(),
      words: samplePage().words.map((w) => (w.x === 1260 && w.y === 375 ? { ...w, text: "40" } : w)),
    };
    const result = readWithTemplate(page, grid());
    expect(result.trust.level).toBe("suspect");
    expect(valueOf(result, "takkyubin-b")?.status).toBe("uncertain");
  });
});

describe("短い見出しの照合", () => {
  it("見出しの文字で始まる語に当たる（読み直しで途中まで取れた見出し）", () => {
    const lines = buildLines(samplePage().words);
    const hit = resolveAnchor(lines, { text: "宅急便", match: "fuzzy" });
    expect(hit?.text).toBe("宅急便個数");
    expect(hit?.box.x).toBe(80);
    // 2文字は別の行の語の頭にも当たるので照合しない
    expect(resolveAnchor(lines, { text: "宅急", match: "fuzzy" })).toBeNull();
  });
});

describe("列見出しの提案の距離", () => {
  it("遠く上にある画面の題を列見出しにしない", () => {
    const words = samplePage().words.map((w) => ({ text: w.text, box: { x: w.x, y: w.y, w: w.w, h: w.h } }));
    // 列見出し行（y=275）を消した状態で、①列の欄を囲む
    const withoutHeaders = words.filter((w) => w.box.y !== 275);
    const suggestion = suggestAnchors({ x: 660, y: 356, w: 126, h: 68 }, withoutHeaders);
    expect(suggestion.column).toBeNull();
    expect(suggestion.row?.text).toBe("宅急便個数");
  });
});
