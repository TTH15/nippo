// ============================================================
// 地図に載せる車両3Dモデルのカタログ（2026-08-10）。
//
// モデル自体は静的アセット（/models/*.glb）なので、カタログはコードで持つ。
// 車両登録では**メーカー名・車種名を選択式（自由記入も可）**にし、
// 選ばれた組み合わせからこの表で `model_key` を決める。
// 表に無い車（自由記入）は既定モデルで描く — 描けないより、それらしく描く方がよい。
//
// モデルは Meshy 生成 → scripts/prepare-vehicle-glb.mjs で
// 実寸・原点=底面中心・1Kテクスチャに整形済み。
// ============================================================

export type VehicleModel = {
  /** vehicles.model_key に入る値 */
  key: string;
  manufacturer: string;
  /** 車種名（vehicles.brand と対応） */
  brand: string;
  url: string;
  /** 別名・表記ゆれ（「エブリィ」「エブリー」など）。照合にだけ使う */
  aliases?: string[];
};

export const VEHICLE_MODELS: VehicleModel[] = [
  {
    key: "every",
    manufacturer: "スズキ",
    brand: "エブリイ",
    url: "/models/every.glb",
    aliases: ["エブリィ", "エブリー", "every", "エブリイバン"],
  },
  {
    key: "clipper",
    manufacturer: "日産",
    brand: "クリッパー",
    url: "/models/clipper.glb",
    aliases: ["NV100", "クリッパーバン", "clipper"],
  },
];

/** 未知の車・未設定のときに使うモデル。 */
export const DEFAULT_VEHICLE_MODEL_KEY = "every";

/** 地図側で addModel するための { key: url }。既定モデルも含む。 */
export const VEHICLE_MODEL_URLS: Record<string, string> = Object.fromEntries(
  VEHICLE_MODELS.map((m) => [m.key, m.url]),
);

const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "");

/**
 * メーカー名・車種名から 3D モデルを決める。
 * 車種名だけで一意に決まることが多い（軽バンは車種名がほぼ固有）ので、
 * メーカー名が空でも照合できるようにする。
 */
export function resolveModelKey(manufacturer: string, brand: string): string | null {
  const b = normalize(brand);
  if (!b) return null;
  const hit = VEHICLE_MODELS.find(
    (m) =>
      normalize(m.brand) === b ||
      (m.aliases ?? []).some((a) => normalize(a) === b) ||
      // 「エブリイワゴン」のような派生も拾う
      b.startsWith(normalize(m.brand)),
  );
  if (!hit) return null;
  // メーカーが入力されていて食い違う場合は採用しない（別メーカーの同名車を誤って当てない）
  if (manufacturer.trim() && normalize(manufacturer) !== normalize(hit.manufacturer)) return null;
  return hit.key;
}

/** 選択肢に出すメーカー名（重複なし）。 */
export const VEHICLE_MANUFACTURERS = [...new Set(VEHICLE_MODELS.map((m) => m.manufacturer))];

/**
 * 常に出す3色。軽貨物はこの3色でほぼ足りる（ユーザー確認 2026-08-10）。
 * これ以外は org のパレット（organizations.vehicle_body_colors）に貯めて使い回す。
 */
export const BODY_COLOR_BASE = [
  { label: "ホワイト", value: "#f1f5f9" },
  { label: "シルバー", value: "#c0c6cc" },
  { label: "ブラック", value: "#1f2937" },
];

/** モデルの URL を引く（未知は既定モデル）。 */
export function modelUrlFor(modelKey: string | null | undefined): string {
  return VEHICLE_MODEL_URLS[modelKey ?? ""] ?? VEHICLE_MODEL_URLS[DEFAULT_VEHICLE_MODEL_KEY];
}
