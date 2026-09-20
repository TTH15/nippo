// 本番 /admin/report-image-templates を再利用。原本画像の様式づくりを架空データだけで確認する。
// 見本画像はこの場で組み立てる架空の表（実物の配達集計精算書は置かない）。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import type { Box, ImageTemplateDefinition } from "@repo/core/logic/reportImageTemplate";

const SAMPLE_WIDTH = 1200;
const SAMPLE_HEIGHT = 470;

// 見本の表の作り。SVGと様式の座標を同じ定義から作り、ずれないようにする
const COLUMNS: { key: string; label: string; x: number; w: number }[] = [
  { key: "label", label: "", x: 40, w: 280 },
  { key: "total", label: "計A", x: 320, w: 150 },
  { key: "input", label: "配完入力", x: 470, w: 180 },
  { key: "done", label: "計B", x: 650, w: 150 },
  { key: "back", label: "持戻C", x: 800, w: 150 },
  { key: "sum", label: "配完+持戻", x: 950, w: 200 },
];
const ROWS: { key: string; label: string; y: number; h: number; values: Record<string, number | null> }[] = [
  { key: "takkyubin", label: "宅急便個数", y: 170, h: 90, values: { total: 40, input: 38, done: 38, back: 2, sum: 40 } },
  { key: "nekopos", label: "ネコポス個数", y: 260, h: 90, values: { total: 5, input: 5, done: 5, back: 0, sum: 5 } },
  { key: "total", label: "合計", y: 350, h: 90, values: { total: 45, input: 43, done: 43, back: 2, sum: 45 } },
];

const cell = (columnKey: string, rowKey: string): Box => {
  const column = COLUMNS.find((c) => c.key === columnKey)!;
  const row = ROWS.find((r) => r.key === rowKey)!;
  return { x: column.x, y: row.y, w: column.w, h: row.h };
};

function sampleSvg(): string {
  const lines: string[] = [
    `<rect width="${SAMPLE_WIDTH}" height="${SAMPLE_HEIGHT}" fill="#ffffff"/>`,
    `<text x="480" y="60" font-family="sans-serif" font-size="26" font-weight="bold" fill="#111">配達集計精算書</text>`,
  ];
  for (const column of COLUMNS) {
    if (!column.label) continue;
    lines.push(
      `<rect x="${column.x}" y="90" width="${column.w}" height="80" fill="#e2e8f0" stroke="#94a3b8"/>`,
      `<text x="${column.x + column.w / 2}" y="140" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#111">${column.label}</text>`,
    );
  }
  lines.push(`<rect x="40" y="90" width="280" height="80" fill="#e2e8f0" stroke="#94a3b8"/>`);
  for (const row of ROWS) {
    lines.push(
      `<rect x="40" y="${row.y}" width="280" height="${row.h}" fill="#e2e8f0" stroke="#94a3b8"/>`,
      `<text x="56" y="${row.y + 52}" font-family="sans-serif" font-size="20" fill="#111">${row.label}</text>`,
    );
    for (const column of COLUMNS) {
      if (column.key === "label") continue;
      const value = row.values[column.key];
      lines.push(`<rect x="${column.x}" y="${row.y}" width="${column.w}" height="${row.h}" fill="#fff" stroke="#94a3b8"/>`);
      if (value != null) {
        lines.push(
          `<text x="${column.x + column.w / 2}" y="${row.y + 56}" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#111">${value}</text>`,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_WIDTH}" height="${SAMPLE_HEIGHT}">${lines.join("")}</svg>`;
}

const SAMPLE_URL = `data:image/svg+xml,${encodeURIComponent(sampleSvg())}`;

/** 見本を読んだときの語（本番では端末内OCRが作る）。ここでは表の作りから組み立てる */
function sampleWords() {
  const words: { text: string; box: Box }[] = [
    { text: "配達集計精算書", box: { x: 480, y: 38, w: 190, h: 28 } },
  ];
  for (const column of COLUMNS) {
    if (!column.label) continue;
    words.push({ text: column.label, box: { x: column.x + column.w / 2 - 30, y: 118, w: 60, h: 22 } });
  }
  for (const row of ROWS) {
    words.push({ text: row.label, box: { x: 56, y: row.y + 32, w: 130, h: 22 } });
    for (const column of COLUMNS) {
      const value = row.values[column.key];
      if (value == null) continue;
      words.push({
        text: String(value),
        box: { x: column.x + column.w / 2 - 14, y: row.y + 34, w: 28, h: 26 },
      });
    }
  }
  return words;
}

const definition = (bound: boolean): ImageTemplateDefinition => ({
  orientation: { rotate: 0 },
  match: {
    required: [{ text: "配達集計精算書", match: "fuzzy", sampleBox: { x: 480, y: 38, w: 190, h: 28 } }],
    optional: [{ text: "ネコポス個数", match: "fuzzy", sampleBox: { x: 56, y: 292, w: 130, h: 22 } }],
    minScore: 0.6,
  },
  sample: { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, unitHeight: 24, words: sampleWords() },
  checks: [{ kind: "sum", totalFieldId: "total-done", partFieldIds: ["takkyubin-done", "nekopos-done"] }],
  fields: [
    {
      id: "total-done",
      role: "check",
      unitId: "",
      fieldKey: "",
      label: "合計 配完",
      value: { type: "int", min: 0, max: 9999 },
      locator: { kind: "region", rect: cell("done", "total") },
      required: false,
    },
    {
      id: "takkyubin-done",
      role: "entry",
      unitId: bound ? "unit-takkyubin" : "",
      fieldKey: bound ? "completed" : "",
      label: "宅急便 配完",
      value: { type: "int", min: 0, max: 999 },
      locator: { kind: "region", rect: cell("done", "takkyubin") },
      required: true,
    },
    {
      id: "takkyubin-back",
      role: "entry",
      unitId: bound ? "unit-takkyubin" : "",
      fieldKey: bound ? "returned" : "",
      label: "宅急便 持戻",
      value: { type: "int", min: 0, max: 999 },
      locator: { kind: "region", rect: cell("back", "takkyubin") },
      required: true,
    },
    {
      id: "nekopos-done",
      role: "entry",
      unitId: bound ? "unit-nekopos" : "",
      fieldKey: bound ? "completed" : "",
      label: "ネコポス 配完",
      value: { type: "int", min: 0, max: 999 },
      locator: { kind: "region", rect: cell("done", "nekopos") },
      required: true,
    },
  ],
});

/**
 * 日報プレビューでも同じ様式を使う。報告項目の紐付けだけ呼び出し側で決める
 * （日報プレビューの架空シフトが持つ unit / field に合わせる）。
 */
export function previewImageTemplate(binding: { unitId: string; doneKey: string; backKey: string }) {
  const base = definition(false);
  return {
    key: "yamato-settlement",
    version: "1",
    name: "ヤマト 配達集計精算書",
    carrierId: null,
    definition: {
      ...base,
      fields: base.fields.map((field) =>
        field.id === "takkyubin-back"
          ? { ...field, unitId: binding.unitId, fieldKey: binding.backKey }
          : field.id === "takkyubin-done"
            ? { ...field, unitId: binding.unitId, fieldKey: binding.doneKey }
            : { ...field, unitId: binding.unitId, fieldKey: binding.doneKey, required: false, id: field.id },
      ),
    },
  };
}

/** 見本画像（架空）。日報プレビューで「読み取り対象の見た目」を示すのに使う */
export const PREVIEW_SAMPLE_IMAGE_URL = SAMPLE_URL;

type Template = {
  id: string;
  carrier_id: string | null;
  template_key: string;
  version: number;
  name: string;
  status: "draft" | "active" | "retired";
  definition: ImageTemplateDefinition;
  sample_storage_path: string | null;
  sample_width: number | null;
  sample_height: number | null;
  note: string | null;
  updated_at: string;
};

const carriers = () => [
  {
    id: "carrier-yamato",
    name: "ヤマト運輸",
    units: [
      {
        id: "unit-takkyubin",
        name: "宅急便",
        fields: [
          { id: "f1", field_key: "completed", label: "完了個数", input_type: "INT" },
          { id: "f2", field_key: "returned", label: "持戻個数", input_type: "INT" },
        ],
      },
      {
        id: "unit-nekopos",
        name: "ネコポス",
        fields: [
          { id: "f3", field_key: "completed", label: "完了個数", input_type: "INT" },
          { id: "f4", field_key: "returned", label: "持戻個数", input_type: "INT" },
        ],
      },
    ],
  },
];

const template = (overrides: Partial<Template>): Template => ({
  id: "tmpl-1",
  carrier_id: "carrier-yamato",
  template_key: "yamato-settlement",
  version: 1,
  name: "ヤマト 配達集計精算書",
  status: "active",
  definition: definition(true),
  sample_storage_path: "preview/sample.svg",
  sample_width: SAMPLE_WIDTH,
  sample_height: SAMPLE_HEIGHT,
  note: null,
  updated_at: "2026-09-19T10:00:00.000Z",
  ...overrides,
});

type State = { templates: Template[]; nextId: number; failWrite: boolean };

export const reportImageTemplatesFixture: PreviewFixture<State> = {
  id: "report-image-templates",
  title: "画像の様式",
  pathname: "/admin/report-image-templates",
  scenarios: {
    normal: { label: "通常", description: "運用中の様式と編集中の版" },
    empty: { label: "未設定", description: "様式が1つも無い" },
    "long-name": { label: "長い名前", description: "名前と項目名の折り返し" },
    large: { label: "多数", description: "20件の様式" },
    error: { label: "保存できない", description: "保存が失敗したときの表示" },
  },
  createState: ({ scenario }) => ({
    nextId: 2,
    failWrite: scenario === "error",
    templates:
      scenario === "empty"
        ? []
        : scenario === "large"
          ? Array.from({ length: 20 }, (_, i) =>
              template({
                id: `tmpl-${i + 1}`,
                template_key: `form-${i + 1}`,
                name: `様式 ${i + 1}`,
                status: i === 0 ? "active" : i % 3 === 0 ? "retired" : "draft",
              }),
            )
          : [
              template({
                name:
                  scenario === "long-name"
                    ? "ヤマト運輸 配達集計精算書（宅急便・ネコポス・EAZY を含む当日ぶんの集計画面）"
                    : "ヤマト 配達集計精算書",
              }),
              template({
                id: "tmpl-2",
                version: 2,
                status: "draft",
                definition: definition(false),
                sample_storage_path: null,
                sample_width: null,
                sample_height: null,
              }),
            ],
  }),
  read: (state, { path }) => {
    if (path === "/api/admin/report-image-templates") return { templates: state.templates };
    if (path.startsWith("/api/admin/report-image-templates/sample")) {
      const id = new URLSearchParams(path.split("?")[1] ?? "").get("id");
      const found = state.templates.find((t) => t.id === id);
      return { url: found?.sample_storage_path ? SAMPLE_URL : null };
    }
    if (path === "/api/admin/carriers") return { carriers: carriers() };
    return undefined;
  },
  write(state, { path, method, body }, { role }) {
    if (!path.startsWith("/api/admin/report-image-templates")) return undefined;
    if (role !== "admin") throw new Error("この操作の権限がありません。");
    if (state.failWrite) throw new Error("様式を保存できませんでした");
    if (method === "POST") {
      const created = template({
        id: `tmpl-${state.nextId++}`,
        template_key: String((body as { templateKey?: string }).templateKey ?? "form"),
        name: String((body as { name?: string }).name ?? "様式"),
        status: "draft",
        definition: (body as { definition: ImageTemplateDefinition }).definition,
        sample_storage_path: null,
        sample_width: null,
        sample_height: null,
      });
      state.templates.push(created);
      return { template: created };
    }
    const id = method === "DELETE" ? new URLSearchParams(path.split("?")[1] ?? "").get("id") : (body as { id?: string }).id;
    const index = state.templates.findIndex((t) => t.id === id);
    if (index < 0) throw new Error("様式が見つかりません");
    if (method === "DELETE") {
      if (state.templates[index].status !== "draft") throw new Error("運用したことがある様式は停止だけできます");
      state.templates.splice(index, 1);
      return { ok: true };
    }
    if (method === "PATCH") {
      const patch = body as Partial<Template>;
      if (patch.status === "active") {
        const unbound = (patch.definition ?? state.templates[index].definition).fields.some(
          (field) => (field.role ?? "entry") === "entry" && (!field.unitId || !field.fieldKey),
        );
        if (unbound) throw new Error("報告項目を決めてください");
        for (const other of state.templates) {
          if (other.template_key === state.templates[index].template_key && other.id !== id && other.status === "active") {
            other.status = "retired";
          }
        }
      }
      state.templates[index] = { ...state.templates[index], ...patch, updated_at: new Date().toISOString() };
      return { template: state.templates[index] };
    }
    return undefined;
  },
};
