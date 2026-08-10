// ============================================================
// 軽バンのカタログと 3D モデル（2026-08-10）。
//
// 2つの表を分けて持つ:
//   ・KEI_VANS      … 車種のカタログ（選択肢に出す。モデルが無い車種も載せる）
//   ・VEHICLE_MODEL_URLS … 実際に用意できた 3D モデル（/models/*.glb）
//
// 分ける理由: 車種は先に増える（ダイハツ アトレー・三菱 ミニキャブ等）が、
// 3D モデルは1台ずつ作るので追いつかない。**モデルが無くても車種は正しく選べる**ようにしておき、
// glb が揃ったら `modelKey` を埋めるだけで地図の見た目が切り替わる。
//
// モデルは Meshy 生成 → scripts/prepare-vehicle-glb.mjs で
// 実寸・原点=底面中心・フラット・プレート別マテリアルに整形済み。
// ============================================================

/**
 * 世代（型式）。同じ車種でも年代で形が全く違うため、3Dモデルは世代ごとに持てるようにする。
 * 型式は車検証に載っていて現場で確実に読める。年式（登録年）よりも正確。
 */
export type KeiVanGeneration = {
  /** 型式（例: DA17V）。vehicles.model_code に入る */
  code: string;
  /** 表示用（例: 「6代目 DA17V（2015年〜）」） */
  label: string;
  /** この世代の 3D モデル。null = 未用意 */
  modelKey: string | null;
};

export type KeiVan = {
  manufacturer: string;
  /** 車種名（vehicles.brand と対応） */
  brand: string;
  /** 型式が分からないときに使う 3D モデル（ふつうは現行世代）。null = 未用意 */
  modelKey: string | null;
  /** 世代。新しい順に並べる。空なら世代を問わない車種 */
  generations?: KeiVanGeneration[];
  /** 表記ゆれ（照合にだけ使う） */
  aliases?: string[];
};

/** 軽貨物で実際に使われる車種。ここに無い車は「その他」で自由入力できる。 */
// ★型式は車検証で確認するのが正。ここは入力の手がかり（候補）であって、
//   一致しない場合は自由入力できるようにしてある。世代を足すときはこの表に1行追加する。
export const KEI_VANS: KeiVan[] = [
  {
    manufacturer: "スズキ",
    brand: "エブリイ",
    modelKey: "every",
    aliases: ["エブリィ", "エブリー", "every"],
    generations: [
      { code: "DA17V", label: "DA17V（2015年〜・現行）", modelKey: "every" },
      { code: "DA64V", label: "DA64V（2005〜2015年）", modelKey: null },
    ],
  },
  {
    manufacturer: "日産",
    brand: "クリッパー",
    modelKey: "clipper",
    aliases: ["NV100", "NV100クリッパー", "clipper"],
    generations: [
      { code: "DR17V", label: "DR17V（2015年〜・現行）", modelKey: "clipper" },
      { code: "DR64V", label: "DR64V（2013〜2015年）", modelKey: null },
    ],
  },
  {
    manufacturer: "ダイハツ",
    brand: "ハイゼットカーゴ",
    modelKey: null,
    aliases: ["ハイゼット", "hijet"],
    generations: [
      { code: "S700V", label: "S700V（2021年〜・現行）", modelKey: null },
      { code: "S321V", label: "S321V（2004〜2021年）", modelKey: null },
    ],
  },
  { manufacturer: "ダイハツ", brand: "アトレー", modelKey: null, aliases: ["アトレーワゴン", "atrai"] },
  {
    manufacturer: "三菱",
    brand: "ミニキャブ",
    modelKey: null,
    aliases: ["ミニキャブバン", "minicab"],
    generations: [{ code: "DS17V", label: "DS17V（2014年〜・現行）", modelKey: null }],
  },
  { manufacturer: "ホンダ", brand: "N-VAN", modelKey: null, aliases: ["エヌバン", "nvan", "N VAN"] },
  { manufacturer: "ホンダ", brand: "アクティバン", modelKey: "acty", aliases: ["アクティ", "acty"] },
  { manufacturer: "トヨタ", brand: "ピクシスバン", modelKey: null, aliases: ["ピクシス", "pixis"] },
  { manufacturer: "マツダ", brand: "スクラム", modelKey: null, aliases: ["スクラムバン", "scrum"] },
  { manufacturer: "スバル", brand: "サンバー", modelKey: null, aliases: ["サンバーバン", "sambar"] },
];

/** 実際に用意できている 3D モデル。 */
export const VEHICLE_MODEL_URLS: Record<string, string> = {
  every: "/models/every.glb",
  clipper: "/models/clipper.glb",
  acty: "/models/acty.glb",
};

/** 未知の車・モデル未用意のときに使うモデル。軽バンは形が似ているので違和感は小さい。 */
export const DEFAULT_VEHICLE_MODEL_KEY = "every";

const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "");

/** カタログから車種を引く（表記ゆれ・派生名を吸収）。 */
export function findKeiVan(manufacturer: string, brand: string): KeiVan | null {
  const b = normalize(brand);
  if (!b) return null;
  const hit = KEI_VANS.find(
    (m) =>
      normalize(m.brand) === b ||
      (m.aliases ?? []).some((a) => normalize(a) === b) ||
      b.startsWith(normalize(m.brand)), // 「エブリイワゴン」等の派生
  );
  if (!hit) return null;
  // メーカーが入力されていて食い違う場合は採用しない（別メーカーの同名車を誤って当てない）
  if (manufacturer.trim() && normalize(manufacturer) !== normalize(hit.manufacturer)) return null;
  return hit;
}

/**
 * メーカー名・車種名・型式から 3D モデルのキーを決める。
 * 型式が分かればその世代のモデル、分からなければ車種の既定（ふつうは現行世代）。
 * どちらも無ければ null（＝標準の軽バンで描く）。
 */
export function resolveModelKey(
  manufacturer: string,
  brand: string,
  modelCode?: string | null,
): string | null {
  const hit = findKeiVan(manufacturer, brand);
  if (!hit) return null;
  const code = (modelCode ?? "").trim().toUpperCase();
  if (code) {
    const gen = hit.generations?.find((g) => g.code.toUpperCase() === code);
    // 型式が分かっているのにその世代のモデルが無いなら、**車種の既定で代用しない**。
    // 形が違う世代を出すくらいなら、標準の軽バンの方が誤解が少ない
    if (gen) return gen.modelKey;
  }
  return hit.modelKey;
}

/** その車種の世代候補（新しい順）。 */
export function generationsOf(manufacturer: string, brand: string): KeiVanGeneration[] {
  return findKeiVan(manufacturer, brand)?.generations ?? [];
}

/** モデルの URL を引く（未知・未用意は既定モデル）。 */
export function modelUrlFor(modelKey: string | null | undefined): string {
  return VEHICLE_MODEL_URLS[modelKey ?? ""] ?? VEHICLE_MODEL_URLS[DEFAULT_VEHICLE_MODEL_KEY];
}

/** メーカーごとにまとめた選択肢（カード表示用）。 */
export const KEI_VANS_BY_MANUFACTURER = KEI_VANS.reduce<Record<string, KeiVan[]>>((acc, v) => {
  (acc[v.manufacturer] ??= []).push(v);
  return acc;
}, {});

/**
 * 常に出す3色。軽貨物はこの3色でほぼ足りる（ユーザー確認 2026-08-10）。
 * これ以外は org のパレット（organizations.vehicle_body_colors）に貯めて使い回す。
 */
export const BODY_COLOR_BASE = [
  { label: "ホワイト", value: "#f1f5f9" },
  { label: "シルバー", value: "#c0c6cc" },
  { label: "ブラック", value: "#1f2937" },
];
