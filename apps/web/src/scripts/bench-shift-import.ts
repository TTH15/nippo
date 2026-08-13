// シフト表 AI 読み取りの速度ベンチ（一時検証用）。
// 旧フォーマット（{day,label} オブジェクト・全セル・effort未指定=high）と
// 新フォーマット（"日:内容" 文字列・空欄省略・effort=medium）を同じ画像で比較する。
// 実行: ANTHROPIC_API_KEY=... npx tsx src/scripts/bench-shift-import.ts <image.jpg>
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { extractShiftFile, type CourseRef } from "../server/ai/shiftImport";

const MODEL = process.env.HAKOTORA_AI_MODEL || "claude-sonnet-5";

const COURSES: CourseRef[] = [
  { id: "1", name: "豊中Amazon昼（リース代抜き）", summary_title: "豊中" },
  { id: "2", name: "ヤマト上京", summary_title: "上京" },
  { id: "3", name: "枚方ミッドナイト", summary_title: "ミッド" },
];

// ---- 旧フォーマット（変更前の schema / prompt を再現） ----
const OLD_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    period: {
      type: "object",
      properties: {
        year: { anyOf: [{ type: "integer" }, { type: "null" }] },
        month: { anyOf: [{ type: "integer" }, { type: "null" }] },
      },
      required: ["year", "month"],
      additionalProperties: false,
    },
    weekdays: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer" },
          weekday: { type: "string", enum: ["月", "火", "水", "木", "金", "土", "日"] },
        },
        required: ["day", "weekday"],
        additionalProperties: false,
      },
    },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          days: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "integer" },
                label: { type: "string", description: "セルの内容を表記のまま。空欄は空文字" },
              },
              required: ["day", "label"],
              additionalProperties: false,
            },
          },
          total: { anyOf: [{ type: "integer" }, { type: "null" }] },
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
          day: { type: "integer" },
          label: { type: "string" },
          count: { type: "integer" },
        },
        required: ["day", "label", "count"],
        additionalProperties: false,
      },
    },
    labelGuesses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          courseName: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["label", "courseName"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["title", "period", "weekdays", "people", "dayTotals", "labelGuesses", "warnings"],
  additionalProperties: false,
};

function oldPrompt(fileName: string): string {
  const courseList = COURSES.map((c) => `${c.name}（略記: ${c.summary_title}）`).join(" / ");
  return [
    `これは配送ドライバーのシフト表です（ファイル名: ${fileName}）。取り込み先は 2026年8月 です。表を読み取り、全員分の「氏名 × 日 × セルの内容」を抽出してください。`,
    "",
    `登録済みコース一覧: ${courseList}`,
    "",
    "ルール:",
    "- まず表・ファイル名に書かれている年月を period に、曜日の行があれば weekdays に入れる。",
    "- 氏名は表の表記のまま。",
    "- day はその列/行が示す「日」(1〜31)。",
    "- label はセルの文字をそのまま。空欄は空文字にする。",
    "- 表に「出勤日数」のような人別合計列があれば total に、日別の実割当人数の集計行があれば dayTotals に入れる。",
    "- 勤務ラベルごとに対応しそうなコースを labelGuesses に入れる。",
    "- 判読が難しい箇所は warnings に残す。",
  ].join("\n");
}


type CellDay = { day: number; label: string };
function validate(people: { name: string; days: CellDay[]; total: number | null }[]): void {
  console.log(`  names=${people.map((p) => p.name).join(",")}`);
  const names = ["田中", "佐藤", "鈴木", "高橋", "伊藤", "渡辺", "山本", "中村", "小林", "加藤", "吉田", "山田"];
  let checked = 0;
  let wrong = 0;
  for (let i = 0; i < names.length; i++) {
    const person = people.find((p) => p.name.includes(names[i]));
    if (!person) {
      console.log(`  ✗ ${names[i]} が見つからない`);
      wrong++;
      continue;
    }
    const byDay = new Map(person.days.map((d) => [d.day, d.label]));
    for (let day = 1; day <= 31; day++) {
      const m = (day + i) % 4;
      const expected = m === 0 ? "休" : m === 1 ? "" : i % 2 === 0 ? "豊中" : "上京";
      const actual = (byDay.get(day) ?? "").trim();
      checked++;
      if (actual !== expected) {
        wrong++;
        if (wrong <= 4) console.log(`  ✗ ${names[i]} ${day}日: 期待「${expected}」実際「${actual}」`);
      }
    }
  }
  console.log(`  検算: ${checked}セル中 誤り${wrong}`);
}

async function runOld(imageB64: string): Promise<void> {
  const client = new Anthropic();
  const t0 = Date.now();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    output_config: {
      format: { type: "json_schema", schema: OLD_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
          { type: "text", text: oldPrompt("シフト表_2026年8月.jpg") },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const text = msg.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text);
  const cells = parsed.people.reduce((n: number, p: { days: unknown[] }) => n + p.days.length, 0);
  console.log(
    `[旧] ${sec}s  output_tokens=${msg.usage.output_tokens}  people=${parsed.people.length}  cells=${cells}`,
  );
  validate(parsed.people);
}

async function runNew(imagePath: string): Promise<void> {
  const bytes = new Uint8Array(fs.readFileSync(imagePath));
  const t0 = Date.now();
  const res = await extractShiftFile(
    { name: "シフト表_2026年8月.jpg", mime: "image/jpeg", bytes },
    { year: 2026, month: 8 },
    COURSES,
  );
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const cells = res.people.reduce((n, p) => n + p.days.length, 0);
  console.log(`[新] ${sec}s  people=${res.people.length}  cells=${cells}`);
  validate(res.people);
  console.log(`  dayTotals=${res.dayTotals.length}件  labelGuesses=${JSON.stringify(res.labelGuesses ?? [])}`);
  console.log(`  warnings=${JSON.stringify(res.warnings)}`);
}

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) throw new Error("usage: bench-shift-import.ts <image>");
  const b64 = fs.readFileSync(imagePath).toString("base64");
  const mode = process.argv[3] ?? "";
  if (mode !== "--old-only") await runNew(imagePath);
  if (mode === "--with-old" || mode === "--old-only") await runOld(b64);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
