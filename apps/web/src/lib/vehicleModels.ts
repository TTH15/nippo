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
      { code: "DA64V", label: "DA64V（2005〜2015年）", modelKey: "every" },
    ],
  },
  {
    manufacturer: "日産",
    brand: "クリッパー",
    modelKey: "clipper",
    aliases: ["NV100", "NV100クリッパー", "clipper"],
    generations: [
      { code: "DR17V", label: "DR17V（2015年〜・現行）", modelKey: "clipper" },
      { code: "DR64V", label: "DR64V（2013〜2015年）", modelKey: "clipper" },
    ],
  },
  {
    manufacturer: "ダイハツ",
    brand: "ハイゼットカーゴ",
    // 型式は当面区別しない（S300前期顔のローポリを全世代に使う。2026-09-06 ユーザー指定）
    modelKey: "hijet",
    aliases: ["ハイゼット", "hijet"],
    generations: [
      { code: "S700V", label: "S700V（2021年〜・現行）", modelKey: "hijet" },
      { code: "S321V", label: "S321V（2004〜2021年）", modelKey: "hijet" },
    ],
  },
  { manufacturer: "ダイハツ", brand: "アトレー", modelKey: "atrai", aliases: ["アトレーワゴン", "atrai"] },
  {
    manufacturer: "三菱",
    brand: "ミニキャブ",
    modelKey: "minicab",
    aliases: ["ミニキャブバン", "minicab"],
    generations: [{ code: "DS17V", label: "DS17V（2014年〜・現行）", modelKey: "minicab" }],
  },
  { manufacturer: "ホンダ", brand: "N-VAN", modelKey: null, aliases: ["エヌバン", "nvan", "N VAN"] },
  { manufacturer: "ホンダ", brand: "アクティバン", modelKey: "acty", aliases: ["アクティ", "acty"] },
  { manufacturer: "トヨタ", brand: "ピクシスバン", modelKey: "pixis", aliases: ["ピクシス", "pixis"] },
  { manufacturer: "マツダ", brand: "スクラム", modelKey: "scrum", aliases: ["スクラムバン", "scrum"] },
  { manufacturer: "スバル", brand: "サンバー", modelKey: "sambar", aliases: ["サンバーバン", "sambar"] },
];

/** 車両編集の3Dプレビュー用の1ファイルモデル（地図の3分割と同じ keivan-3d 版。旧 Meshy 版は廃止 2026-09-07）。 */
export const VEHICLE_MODEL_URLS: Record<string, string> = {
  hijet: "/models/hijet-s300-blockout-19.glb",
  every: "/models/every-da64v-blockout-88.glb",
  acty: "/models/acty-hh5-blockout-75.glb",
};

/** 未知の車・モデル未用意のときに使うモデル。軽バンは形が似ているので違和感は小さい。 */
export const DEFAULT_VEHICLE_MODEL_KEY = "every";

// ============================================================
// 地図（/admin/map）用の低ポリモデル。1車種 = 「着色する車体」と「固定色の部品（窓・タイヤ・灯火）」の
// 2ファイルに分割し（scripts/split-vehicle-map-model.mjs）、Mapbox の model レイヤーへ2層で重ねる。
// 型式は当面扱わず車種単位で選ぶ（2026-09-06 ユーザー指定）。未登録の車種は既定モデルへ倒す。
// ============================================================
export type VehicleMapModel = {
  /** Mapbox addModel の識別子の接頭辞（tinted / fixed / lamps を付けて使う） */
  id: string;
  tintedUrl: string;
  fixedUrl: string;
  /** ヘッドライト・テールランプだけのファイル。夜に発光させる */
  lampsUrl: string;
  /** 全長（m）。見かけサイズの計算に使う */
  lengthMeters: number;
};

// 3車種とも ~/Developer/assets/keivan-3d の比率修正版（2026-09-06）を finish-glb-for-mapbox → split で3分割したもの
export const VEHICLE_MAP_MODELS: Record<string, VehicleMapModel> = {
  hijet: {
    id: "hijet-s300-blockout-19",
    tintedUrl: "/models/hijet-s300-blockout-19-tinted.glb",
    fixedUrl: "/models/hijet-s300-blockout-19-fixed.glb",
    lampsUrl: "/models/hijet-s300-blockout-19-lamps.glb",
    lengthMeters: 3.395,
  },
  every: {
    id: "every-da64v-blockout-88",
    tintedUrl: "/models/every-da64v-blockout-88-tinted.glb",
    fixedUrl: "/models/every-da64v-blockout-88-fixed.glb",
    lampsUrl: "/models/every-da64v-blockout-88-lamps.glb",
    lengthMeters: 3.395,
  },
  acty: {
    id: "acty-hh5-blockout-75",
    tintedUrl: "/models/acty-hh5-blockout-75-tinted.glb",
    fixedUrl: "/models/acty-hh5-blockout-75-fixed.glb",
    lampsUrl: "/models/acty-hh5-blockout-75-lamps.glb",
    lengthMeters: 3.392,
  },
};

/** OEM・同型車は元車種の地図モデルを使う（外観がほぼ同じ） */
export const VEHICLE_MAP_MODEL_ALIASES: Record<string, string> = {
  clipper: "every", // 日産クリッパー = エブリイ
  scrum: "every", // マツダスクラム = エブリイ
  minicab: "every", // 三菱ミニキャブ（2014〜） = エブリイ
  pixis: "hijet", // トヨタピクシスバン = ハイゼット
  sambar: "hijet", // スバルサンバー（2012〜） = ハイゼット
  atrai: "hijet", // ダイハツアトレー = ハイゼット系
};

/** 地図用の既定モデル（未登録の車種・車種未登録の車） */
export const DEFAULT_VEHICLE_MAP_MODEL_KEY = "every";

/** 車種キーから地図用モデルを選ぶ。OEM は元車種へ、未設定・未登録は既定へ */
export function vehicleMapModelFor(modelKey: string | null | undefined): VehicleMapModel {
  const key = modelKey ? VEHICLE_MAP_MODEL_ALIASES[modelKey] ?? modelKey : null;
  return (key && VEHICLE_MAP_MODELS[key]) || VEHICLE_MAP_MODELS[DEFAULT_VEHICLE_MAP_MODEL_KEY];
}

/**
 * 車両行から地図用の車種キーを決める。保存済みの model_key を優先し、無ければメーカー＋車種名から引く
 * （車種キーを持つ前に登録した車も、登録し直さずに車種のモデルで出す。2026-09-07）
 */
export function mapModelKeyForVehicle(vehicle: {
  model_key?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
}): string | null {
  if (vehicle.model_key) return vehicle.model_key;
  if (vehicle.manufacturer && vehicle.brand) return resolveModelKey(vehicle.manufacturer, vehicle.brand);
  return null;
}

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
  const key = modelKey ? VEHICLE_MAP_MODEL_ALIASES[modelKey] ?? modelKey : "";
  return VEHICLE_MODEL_URLS[key] ?? VEHICLE_MODEL_URLS[DEFAULT_VEHICLE_MODEL_KEY];
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
