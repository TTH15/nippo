// シフト表（PDF・画像）の AI 読み取り。
// 取引先ごとに形式がバラバラ（行=人/行=日付、〇/休、色付き略号、分割スクショ等）なため、
// 固定パーサーではなく Claude の vision + structured outputs で「人 × 日 × セル文字」を抽出する。
// マージ・ドライバー/コースへの対応付けはサーバー側で行い、最終確定は管理者がプレビューで行う。
import { createHash } from "node:crypto";
import { getAnthropic } from "./client";

// コスト優先の既定（ユーザー方針）。精度検証時は env で claude-opus-5 等に切替可能。
const MODEL = process.env.HAKOTORA_AI_MODEL || "claude-sonnet-5";
// 一度確定した表形式は、構造ヒントを渡して軽量モデルで先に読む。
// 精度検算に失敗した場合は MODEL へ自動フォールバックするため、安全側を維持できる。
const FAST_MODEL = process.env.HAKOTORA_AI_FAST_MODEL || "claude-haiku-4-5";
// 思考の深さ。表の読み取りは知覚・転記タスクで深い推論は不要なため low を既定にする
// （未指定だと high 相当で待ち時間が数倍になる。合成シフト表での検証は low/medium とも全セル正解、
//   high は3倍遅くて精度向上なし＝bench-shift-import.ts 参照。実ファイルで精度が落ちる場合は
//   HAKOTORA_AI_EFFORT=medium / high に上げる）。
const EFFORT = (process.env.HAKOTORA_AI_EFFORT || "low") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ExtractedDay = { day: number; label: string };
export type ExtractedPerson = { name: string; days: ExtractedDay[]; total: number | null };
/** 資料内の「日別の人数集計」（例: 豊中人数）。抽出結果の検算に使う */
export type ExtractedDayTotal = { day: number; label: string; count: number };
/** ラベル→コースの AI 推定。「〇」のようにファイル名・表タイトルからしか判断できない表記のため */
export type ExtractedLabelGuess = {
  label: string;
  courseName: string | null;
  /** C1/C2など、表記から特定できた便。全便・不明は null。 */
  cycleNo: number | null;
};
export type ExtractedFileResult = {
  sourceName: string;
  title: string;
  /** 表・ファイル名に明記されていた年月（無ければ null）。誤った月への取り込み防止に使う */
  period: { year: number | null; month: number | null };
  /** 表の曜日行（あれば）。年月が書かれていない表でも対象月とのズレを検出できる */
  weekdays: { day: number; weekday: string }[];
  people: ExtractedPerson[];
  dayTotals: ExtractedDayTotal[];
  labelGuesses: ExtractedLabelGuess[];
  /** 翌月以降に再利用できる、氏名や日別内容を含まない表構造の説明。 */
  formatProfile: string;
  warnings: string[];
};

export type CourseRef = {
  id: string;
  name: string;
  summary_title?: string | null;
  uses_cycles?: boolean | null;
  course_cycles?: { cycle_no: number; label?: string | null; active?: boolean | null }[] | null;
};

/**
 * AI 出力の「日:内容」文字列を分解する（出力トークン削減のための圧縮表現）。
 * 内容側に「9:00〜14:00」のようなコロンが含まれても壊れないよう、最初のコロンだけで区切る。
 */
export function parseDayEntry(entry: string): ExtractedDay | null {
  const i = entry.indexOf(":");
  if (i <= 0) return null;
  const day = Number(entry.slice(0, i));
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { day, label: entry.slice(i + 1).trim() };
}

export type ImportFile = { name: string; mime: string; bytes: Uint8Array };

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "シフト表のタイトルや対象拠点（読み取れる範囲で。無ければ空文字）",
    },
    period: {
      type: "object",
      properties: {
        year: {
          anyOf: [{ type: "integer" }, { type: "null" }],
          description: "表・ファイル名に明記されている年（西暦）。書かれていなければ null",
        },
        month: {
          anyOf: [{ type: "integer" }, { type: "null" }],
          description: "表・ファイル名に明記されている月。書かれていなければ null",
        },
      },
      required: ["year", "month"],
      additionalProperties: false,
    },
    weekdays: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer", description: "日（1〜31）" },
          weekday: {
            type: "string",
            enum: ["月", "火", "水", "木", "金", "土", "日"],
          },
        },
        required: ["day", "weekday"],
        additionalProperties: false,
      },
      description: "表に曜日の行・列があれば、各日の曜日。無ければ空配列",
    },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "表に書かれている表記のままの氏名" },
          days: {
            type: "array",
            items: {
              type: "string",
              description:
                "「日:セルの内容」形式（例: \"5:豊中\" \"12:休\"）。日は1〜31、内容は表記のまま。空欄の日は内容を空にする（例: \"12:\"）",
            },
            description:
              "表にあるすべての日を1日から順に「日:内容」形式で列挙する（空欄の日も \"12:\" のように必ず含める。日付の対応ズレを防ぐため省略しない）",
          },
          total: {
            anyOf: [{ type: "integer" }, { type: "null" }],
            description: "この人の出勤日数の合計列（例: 出勤日数）が表にあればその値。無ければ null",
          },
        },
        required: ["name", "days", "total"],
        additionalProperties: false,
      },
    },
    dayTotals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer", description: "日（1〜31）" },
          label: {
            type: "string",
            description: "何の人数か（例: 「豊中人数」の行なら 豊中、「上京」集計行なら 上京）",
          },
          count: { type: "integer", description: "その日の実際の割当人数" },
        },
        required: ["day", "label", "count"],
        additionalProperties: false,
      },
      description:
        "日ごとの『実際の割当人数』の集計行・列があれば抽出（検算に使う）。「必要人数」のような必要数・予定数の行は含めない。無ければ空配列",
    },
    labelGuesses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "表に出てくる勤務ラベル（表記のまま）" },
          courseName: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "対応しそうな登録済みコースの name（一覧の表記そのまま）。確信が無ければ null",
          },
          cycleNo: {
            anyOf: [{ type: "integer" }, { type: "null" }],
            description: "C1/C2・1便/2便などで特定できる便番号。不明・全便は null",
          },
        },
        required: ["label", "courseName", "cycleNo"],
        additionalProperties: false,
      },
      description:
        "この表に出てくる勤務ラベル（休み以外）それぞれについて、登録済みコース一覧のどれに対応しそうかの推定。ファイル名・表のタイトル・拠点名を手掛かりにする（例: 枚方ミッドナイトの表の「〇」→ ミッドナイト系コース）",
    },
    formatProfile: {
      type: "string",
      description:
        "次回同じ帳票形式を読むための短い構造説明。氏名・具体的な日別勤務内容は含めず、行列の向き、日付見出し、氏名列、集計欄、セル表記規則だけを書く",
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["title", "period", "weekdays", "people", "dayTotals", "labelGuesses", "formatProfile", "warnings"],
  additionalProperties: false,
} as const;

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function buildPrompt(
  year: number,
  month: number,
  fileName: string,
  courses: CourseRef[],
  knownFormatProfile?: string | null,
): string {
  const courseList = courses
    .map((c) => {
      const base = c.summary_title?.trim() ? `${c.name}（略記: ${c.summary_title.trim()}）` : c.name;
      const cycles = c.uses_cycles
        ? (c.course_cycles ?? [])
            .filter((cycle) => cycle.active !== false)
            .map((cycle) => cycle.label?.trim() || `C${cycle.cycle_no}`)
            .join("・")
        : "";
      return cycles ? `${base}［便: ${cycles}］` : base;
    })
    .join(" / ");
  return [
    `これは配送ドライバーのシフト表です（ファイル名: ${fileName}）。取り込み先は ${year}年${month}月 です。表を読み取り、全員分の「氏名 × 日 × セルの内容」を抽出してください。`,
    "",
    `登録済みコース一覧: ${courseList || "（なし）"}`,
    knownFormatProfile
      ? `前回確定した同形式の構造: ${knownFormatProfile}\nこの構造を優先して読み、実際の表と違う場合だけ現物を正としてください。`
      : "",
    "",
    "ルール:",
    `- まず表・ファイル名に書かれている年月を period に、曜日の行があれば weekdays に入れる。`,
    `- 表の年月が取り込み先（${year}年${month}月）と明らかに異なる場合は、誤った月への取り込みを防ぐため people・dayTotals・labelGuesses は空のままにし、period と warnings だけ返して終了する。`,
    "- 氏名は表の表記のまま（敬称・記号・括弧も含めてそのまま）。",
    "- 各人の days は「日:セルの内容」の文字列（例: 5:豊中 / 12:休 / 20:〇）。日はその列/行が示す「日」(1〜31)で、曜日や年月の行から正しく対応付けること。",
    "- days は表にあるすべての日を1日から順に列挙する（空欄の日も「12:」のように内容を空で必ず含める。飛ばすと日付の対応がズレるため省略しない）。",
    "- セルの内容は表記のまま（例: 豊中 / 久御山 / 休 / 〇 / 1便 / E槇 / 上京）。",
    "- 表が人ごとの行でも日付ごとの行でも、出力は必ず「人 → 日ごとの値」に正規化する。",
    "- 画像がスプレッドシートのスクリーンショットの一部（列が途中で切れている等）の場合は、写っている範囲だけを抽出する。",
    "- people には集計行（人数・合計・必要人数など）や氏名でない行を含めない。",
    "- 表に「出勤日数」のような人別合計列があれば total に、「◯◯人数」のような日別の実割当人数の集計行があれば dayTotals に入れる（検算に使う。必要人数・予定数は対象外）。",
    "- 勤務ラベル（休み以外）ごとに、登録済みコース一覧のどれに対応しそうかを labelGuesses に入れる。「〇」のような記号だけのラベルも、ファイル名や表のタイトル・拠点名から対応コースを推定する。courseName は一覧の name をそのまま書く。対応しそうなコースが無ければ null。",
    "- ラベルに C1/C2、1便/2便などがあれば cycleNo に便番号を入れる。コースだけで便が特定できない場合や全便なら null。",
    "- formatProfile には、翌月に同じ形式を読むための表構造だけを簡潔に記述する。氏名・具体的な日別割当・個人情報は絶対に含めない。",
    "- 判読が難しいセル・自信がない箇所は warnings に日本語で残す。",
  ].join("\n");
}

/** 1ファイルを Claude で読み取る。courses はラベル→コース推定の手掛かりとしてプロンプトに渡す。 */
export async function extractShiftFile(
  file: ImportFile,
  ym: { year: number; month: number },
  courses: CourseRef[],
  options?: { knownFormatProfile?: string | null; fast?: boolean },
): Promise<ExtractedFileResult> {
  const client = getAnthropic();
  const data = Buffer.from(file.bytes).toString("base64");

  const mediaBlock =
    file.mime === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: (IMAGE_MIMES.has(file.mime) ? file.mime : "image/jpeg") as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
            data,
          },
        };

  const stream = client.messages.stream({
    model: options?.fast ? FAST_MODEL : MODEL,
    max_tokens: options?.fast ? 32000 : 64000,
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: "user",
        content: [
          mediaBlock,
          {
            type: "text",
            text: buildPrompt(ym.year, ym.month, file.name, courses, options?.knownFormatProfile),
          },
        ],
      },
    ],
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error(`AI がファイル「${file.name}」の読み取りを拒否しました`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(`ファイル「${file.name}」の読み取り結果が大きすぎます（分割して取り込んでください）`);
  }

  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  // days は出力トークン削減のため「日:内容」の文字列で受け取り、ここで構造化する
  type RawExtracted = Omit<ExtractedFileResult, "sourceName" | "people"> & {
    people: { name: string; days: string[]; total: number | null }[];
  };
  let raw: RawExtracted;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`ファイル「${file.name}」の読み取り結果を解析できませんでした`);
  }
  const warnings = [...(raw.warnings ?? [])];
  const parsed: Omit<ExtractedFileResult, "sourceName"> = {
    ...raw,
    warnings,
    people: (raw.people ?? []).map((p) => {
      const days: ExtractedDay[] = [];
      for (const entry of p.days ?? []) {
        const d = parseDayEntry(entry);
        if (d) days.push(d);
        else warnings.push(`「${p.name}」の値「${entry}」を日付に対応付けできませんでした`);
      }
      return { name: p.name, days, total: p.total };
    }),
  };

  // ---- 期間ガード ----
  // 1) 表・ファイル名に年月が明記されていて取り込み先と違う → そのファイルを弾く
  const p = parsed.period ?? { year: null, month: null };
  if (
    (p.month !== null && p.month !== ym.month) ||
    (p.year !== null && p.year !== ym.year)
  ) {
    const label = `${p.year ?? "?"}年${p.month ?? "?"}月`;
    throw new Error(
      `「${file.name}」は ${label} の表のようです（取り込み先: ${ym.year}年${ym.month}月）。対象の月を切り替えるか、正しいファイルを選んでください`,
    );
  }
  // 2) 年月が書かれていない表でも、曜日の並びが対象月のカレンダーと合わなければ別の月と判断
  const JP_WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const wd = (parsed.weekdays ?? []).filter(
    (w) => Number.isInteger(w.day) && w.day >= 1 && w.day <= 31 && JP_WEEKDAYS.includes(w.weekday),
  );
  if (wd.length >= 3) {
    const mismatch = wd.filter(
      (w) => JP_WEEKDAYS[new Date(ym.year, ym.month - 1, w.day).getDay()] !== w.weekday,
    ).length;
    if (mismatch > wd.length / 2) {
      throw new Error(
        `「${file.name}」の曜日の並びが ${ym.year}年${ym.month}月 と一致しません（別の月のシフト表の可能性）。対象の月を確認してください`,
      );
    }
  }

  return { ...parsed, sourceName: file.name };
}

/**
 * 月・日付部分を除いたファイル名の系統から、同じ帳票形式を引くためのキーを作る。
 * 「2026年8月 豊中シフト.pdf」→ 翌月の同系列へ一致する。名前が汎用的すぎる場合は学習しない。
 */
export function shiftImportFormatKey(fileName: string, mime: string): string | null {
  const stem = fileName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.(pdf|jpe?g|png|webp|gif)$/i, "")
    .replace(/20\d{2}\s*[年._\-/]?\s*\d{1,2}\s*月?/g, "")
    .replace(/\d{1,2}\s*月/g, "")
    .replace(/(?:前半|後半|上期|下期)/g, "")
    .replace(/\d+/g, "")
    .replace(/[\s　._\-/()[\]（）]+/g, "");
  if (stem.length < 3) return null;
  // ファイル名に氏名などが含まれていても、新設テーブルへそのまま残さない。
  const digest = createHash("sha256").update(stem).digest("hex");
  return `${mime}:${digest}`;
}

/** 高速モデルの結果を通常モデルへフォールバックさせる最低限の検算。 */
export function isReliableFastExtraction(result: ExtractedFileResult): boolean {
  if (result.people.length === 0) return false;
  const withDays = result.people.filter((person) => person.days.some((day) => day.label.trim() !== ""));
  if (withDays.length === 0) return false;
  const peopleWithTotal = result.people.filter((person) => person.total !== null);
  if (peopleWithTotal.length >= 2) {
    const matched = peopleWithTotal.filter(
      (person) => person.days.filter((day) => !isOffLabel(day.label)).length === person.total,
    ).length;
    if (matched / peopleWithTotal.length < 0.7) return false;
  }
  return true;
}

// ---- マージ・対応付け（AI を使わない決定的処理） ----

/** 全角空白・空白を除去した比較用正規化。 */
export function normalizeJa(s: string): string {
  return s.replace(/[\s　]/g, "").trim();
}

/** 「休み」を意味するラベルか（空欄含む）。 */
export function isOffLabel(label: string): boolean {
  const v = normalizeJa(label);
  if (v === "") return true;
  return ["休", "公休", "指定休", "希望休", "休み", "×", "✕", "x", "X", "−", "-", "—", "／", "/"].includes(v);
}

export type MergedPerson = {
  name: string;
  /** day(1-31) → セル表記。複数ファイルで矛盾した場合は先勝ち＋warning。 */
  days: Record<number, string>;
  sources: string[];
  /** 資料に載っていた出勤日数の合計（無ければ null）。検算に使う */
  total: number | null;
};

/** 出勤ラベル同士が別ファイルで食い違ったケース（休 vs 出勤 は競合扱いしない） */
export type MergeConflict = { name: string; day: number; kept: string; dropped: string; source: string };

export function mergeExtractedFiles(results: ExtractedFileResult[]): {
  people: MergedPerson[];
  labels: string[];
  dayTotals: ExtractedDayTotal[];
  conflicts: MergeConflict[];
  /** 正規化ラベル → AI 推定コース名（ファイル文脈からの推定。先勝ち） */
  labelGuesses: Record<string, string>;
  warnings: string[];
} {
  const byName = new Map<string, MergedPerson>();
  const labelSet = new Set<string>();
  const dayTotalsByKey = new Map<string, ExtractedDayTotal>();
  const conflicts: MergeConflict[] = [];
  const labelGuesses: Record<string, string> = {};
  const warnings: string[] = [];

  for (const r of results) {
    warnings.push(...r.warnings.map((w) => `${r.sourceName}: ${w}`));
    for (const g of r.labelGuesses ?? []) {
      const key = normalizeJa(g.label);
      if (key && g.courseName && !labelGuesses[key]) labelGuesses[key] = g.courseName;
    }
    for (const t of r.dayTotals ?? []) {
      if (!Number.isInteger(t.day) || t.day < 1 || t.day > 31) continue;
      const key = `${t.day}|${normalizeJa(t.label)}`;
      if (!dayTotalsByKey.has(key)) dayTotalsByKey.set(key, { ...t, label: t.label.trim() });
    }
    for (const p of r.people) {
      const key = normalizeJa(p.name);
      if (!key) continue;
      let merged = byName.get(key);
      if (!merged) {
        merged = { name: p.name.trim(), days: {}, sources: [], total: null };
        byName.set(key, merged);
      }
      if (!merged.sources.includes(r.sourceName)) merged.sources.push(r.sourceName);
      if (merged.total === null && typeof p.total === "number") merged.total = p.total;
      for (const d of p.days) {
        if (!Number.isInteger(d.day) || d.day < 1 || d.day > 31) continue;
        const label = d.label.trim();
        const existing = merged.days[d.day];
        if (existing === undefined) {
          merged.days[d.day] = label;
        } else {
          // ルール: どこかのファイルで出勤なら出勤（休・空欄は負けるだけで競合ではない）。
          // 競合として扱うのは「出勤 vs 別の出勤」だけ。
          const existingOff = isOffLabel(existing);
          const newOff = isOffLabel(label);
          if (existingOff && !newOff) {
            merged.days[d.day] = label;
          } else if (!existingOff && !newOff && normalizeJa(existing) !== normalizeJa(label)) {
            conflicts.push({
              name: merged.name,
              day: d.day,
              kept: existing,
              dropped: label,
              source: r.sourceName,
            });
          }
        }
        if (label !== "" && !isOffLabel(label)) labelSet.add(label);
      }
    }
  }

  return {
    people: [...byName.values()],
    labels: [...labelSet].sort(),
    dayTotals: [...dayTotalsByKey.values()].sort((a, b) => a.day - b.day),
    conflicts,
    labelGuesses,
    warnings,
  };
}

/** AI 推定コース名（labelGuesses の値）を courses の実体に解決する。 */
export function resolveCourseByName(courseName: string, courses: CourseRef[]): string | null {
  const target = normalizeJa(courseName);
  if (!target) return null;
  const exact = courses.filter(
    (c) => normalizeJa(c.name) === target || normalizeJa(c.summary_title ?? "") === target,
  );
  if (exact.length === 1) return exact[0].id;
  const partial = courses.filter(
    (c) => normalizeJa(c.name).includes(target) || target.includes(normalizeJa(c.name)),
  );
  return partial.length === 1 ? partial[0].id : null;
}

// ---- 集計検算 ----
// 資料自身に含まれる集計（出勤日数・◯◯人数）と、抽出結果を集計し直した値を突き合わせる。
// AI の読みを AI 自身の別出力で検算する形になり、両方が同じ方向に間違う確率は低い。

export type ImportChecks = {
  /** 人別: 資料の出勤日数 vs 抽出した出勤日数（表が半月分の場合は合わないことがある） */
  personTotals: { name: string; expected: number; actual: number; ok: boolean }[];
  /** 日別: 資料の人数集計 vs 抽出したその日のラベル一致人数 */
  dayTotals: { day: number; label: string; expected: number; actual: number; ok: boolean }[];
};

export function computeChecks(people: MergedPerson[], dayTotals: ExtractedDayTotal[]): ImportChecks {
  const personTotals = people
    .filter((p) => p.total !== null)
    .map((p) => {
      const actual = Object.values(p.days).filter((v) => !isOffLabel(v)).length;
      return { name: p.name, expected: p.total as number, actual, ok: actual === p.total };
    });

  const dayChecks = dayTotals.map((t) => {
    const target = normalizeJa(t.label);
    const actual = people.filter((p) => normalizeJa(p.days[t.day] ?? "") === target).length;
    return { day: t.day, label: t.label, expected: t.count, actual, ok: actual === t.count };
  });

  return { personTotals, dayTotals: dayChecks };
}

/** 抽出された氏名 → 登録ドライバーの候補。姓のみ表記（例: 野口）にも対応する。 */
export function suggestDriverId(
  rawName: string,
  drivers: { id: string; name: string; display_name?: string | null }[],
): string | null {
  const raw = normalizeJa(rawName).replace(/[（(].*?[)）]/g, "");
  if (!raw) return null;
  const candidates = drivers.filter((d) => {
    const names = [d.name, d.display_name ?? ""].map(normalizeJa).filter(Boolean);
    return names.some((n) => n === raw || n.startsWith(raw) || raw.startsWith(n) || n.includes(raw));
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

/** 抽出されたラベル（勤務地・便など）→ コースの候補。 */
export function suggestCourseId(
  label: string,
  courses: { id: string; name: string; summary_title?: string | null }[],
): string | null {
  const raw = normalizeJa(label);
  if (!raw) return null;
  const candidates = courses.filter((c) => {
    const names = [c.name, c.summary_title ?? ""].map(normalizeJa).filter(Boolean);
    return names.some((n) => n === raw || n.includes(raw) || raw.includes(n));
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

/** C1 / C2 / 1便 / 2便などの表記を、対象コースの有効な便番号へ解決する。 */
export function suggestCycleNo(label: string, course: CourseRef | null | undefined): number {
  if (!course?.uses_cycles) return 0;
  const normalized = label.normalize("NFKC");
  const match = normalized.match(/(?:^|[^A-Z0-9])C\s*(\d+)(?:$|[^0-9])/i) ?? normalized.match(/(\d+)\s*便/);
  if (!match) return 0;
  const cycleNo = Number(match[1]);
  const active = (course.course_cycles ?? []).some(
    (cycle) => cycle.active !== false && cycle.cycle_no === cycleNo,
  );
  return active ? cycleNo : 0;
}
