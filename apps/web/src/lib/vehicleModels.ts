import assetData from "./vehicleModelAssets.json";
type VehicleModelAsset = { key: string; label: string; manufacturer: string; brand: string; codes: string[]; id: string; lengthMeters: number; fixedPaintMaterials?: string[] };
const assets: VehicleModelAsset[] = assetData;

// 車両の識別情報と表示用GLBは分離する。制作元の版・ハッシュは台帳で固定。
export type KeiVanGeneration = { code: string; label: string; modelKey: string | null };
export type KeiVan = {
  manufacturer: string; brand: string; modelKey: string | null;
  generations?: KeiVanGeneration[]; aliases?: string[];
};
export const VEHICLE_MODEL_ASSETS = assets;
export const KEI_VANS: KeiVan[] = [
  { manufacturer: "スズキ", brand: "エブリイ", modelKey: "every", aliases: ["エブリィ", "エブリー", "every"] },
  { manufacturer: "日産", brand: "クリッパー", modelKey: "clipper", aliases: ["NV100", "NV100クリッパー", "clipper"] },
  { manufacturer: "ダイハツ", brand: "ハイゼットカーゴ", modelKey: "hijet", aliases: ["ハイゼット", "hijet"] },
  { manufacturer: "ダイハツ", brand: "アトレー", modelKey: "atrai", aliases: ["アトレーワゴン", "atrai"] },
  { manufacturer: "三菱", brand: "ミニキャブ", modelKey: "minicab", aliases: ["ミニキャブバン", "minicab"] },
  { manufacturer: "ホンダ", brand: "N-VAN", modelKey: null, aliases: ["エヌバン", "nvan", "N VAN"] },
  { manufacturer: "ホンダ", brand: "アクティバン", modelKey: "acty", aliases: ["アクティ", "acty"] },
  { manufacturer: "トヨタ", brand: "ピクシスバン", modelKey: "pixis", aliases: ["ピクシス", "pixis"] },
  { manufacturer: "マツダ", brand: "スクラム", modelKey: "scrum", aliases: ["スクラムバン", "scrum"] },
  { manufacturer: "スバル", brand: "サンバー", modelKey: "sambar", aliases: ["サンバーバン", "sambar"] },
];

export type VehicleMapModel = {
  id: string; tintedUrl: string; fixedUrl: string; lampsUrl: string; lengthMeters: number;
  fixedPaintMaterials: string[];
};
export const VEHICLE_MAP_MODEL_ALIASES: Record<string, string> = {
  every: "every-da64v", hijet: "hijet-s300", acty: "acty-hh5",
  clipper: "every-da64v", scrum: "every-da64v", minicab: "every-da64v",
  pixis: "hijet-s300", sambar: "hijet-s300", atrai: "atrai-s220",
};
export const DEFAULT_VEHICLE_MODEL_KEY = "every-da64v";
export const DEFAULT_VEHICLE_MAP_MODEL_KEY = DEFAULT_VEHICLE_MODEL_KEY;
export const VEHICLE_MODEL_URLS: Record<string, string> = Object.fromEntries(assets.map(a => [a.key, `/models/${a.id}.glb`]));
export const VEHICLE_MAP_MODELS: Record<string, VehicleMapModel> = Object.fromEntries(assets.map(a => [a.key, {
  id: a.id, tintedUrl: `/models/${a.id}-tinted.glb`, fixedUrl: `/models/${a.id}-fixed.glb`,
  lampsUrl: `/models/${a.id}-lamps.glb`, lengthMeters: a.lengthMeters,
  fixedPaintMaterials: a.fixedPaintMaterials ?? [],
}]));
export const VEHICLE_MAP_MODEL_LABELS: Record<string, string> = Object.fromEntries(assets.map(a => [a.key, a.label]));
const normalize = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/[\s‐‑−–—]/g, "");

/** 原表記はmodel_codeに保持し、照合時だけ接頭辞・全半角を整える。「改」は自動判定しない。 */
export function normalizeModelCode(value?: string | null): string {
  const code = (value ?? "").normalize("NFKC").toUpperCase().replace(/[‐‑−–—ー]/g, "-").replace(/\s/g, "");
  return code.replace(/^(?:E|V|GF|GD|GE|LA|LE|TA|TE|ABA|CBA|DBA|GBD|EBD|HBD|DAA|ZAA|3BD|4BD|5BD|3BA|4BA|5BA|5AA|6AA)-/, "");
}
export function findKeiVan(manufacturer: string, brand: string): KeiVan | null {
  const maker = normalize(manufacturer), b = normalize(brand);
  return KEI_VANS.find(v => (!maker || normalize(v.manufacturer) === maker) &&
    [v.brand, ...(v.aliases ?? [])].some(a => normalize(a) === b)) ?? null;
}
export function modelChoicesFor(manufacturer: string, brand: string) {
  const v = findKeiVan(manufacturer, brand);
  return v ? assets.filter(a => a.manufacturer === v.manufacturer && a.brand === v.brand) : [];
}
export function generationsOf(manufacturer: string, brand: string): KeiVanGeneration[] {
  return modelChoicesFor(manufacturer, brand).flatMap(a => a.codes.map(code => ({ code, label: code, modelKey: a.key })));
}
/** 書類の車名（メーカー）と基本型式から通称車種を引く。曖昧な写真仕様は含めない。 */
export function vehicleIdentityForCode(modelCode: string, manufacturer = ""): KeiVan | null {
  const code = normalizeModelCode(modelCode);
  const hits = assets.filter(a => a.codes.includes(code) && (!manufacturer || normalize(a.manufacturer) === normalize(manufacturer)));
  const identities = [...new Set(hits.map(a => `${a.manufacturer}/${a.brand}`))];
  return identities.length === 1 ? findKeiVan(hits[0].manufacturer, hits[0].brand) : null;
}
export function resolveModelKey(manufacturer: string, brand: string, modelCode?: string | null): string | null {
  const hit = findKeiVan(manufacturer, brand);
  if (!hit) return null;
  if (modelCode?.trim()) return generationsOf(manufacturer, brand).find(g => g.code === normalizeModelCode(modelCode))?.modelKey ?? null;
  return hit.modelKey;
}
/** 手動で選んだ外観だけを明示。旧model_keyの汎用車種と区別し、型式の自動解決を妨げない。 */
export const APPEARANCE_PREFIX = "appearance:";
export function mapModelKeyForVehicle(vehicle: {
  model_key?: string | null; model_code?: string | null; manufacturer?: string | null; brand?: string | null;
}): string | null {
  const saved = vehicle.model_key ?? "";
  if (saved.startsWith(APPEARANCE_PREFIX)) {
    const key = saved.slice(APPEARANCE_PREFIX.length);
    if (modelChoicesFor(vehicle.manufacturer ?? "", vehicle.brand ?? "").some(a => a.key === key)) return key;
  }
  if (vehicle.manufacturer && vehicle.brand) return resolveModelKey(vehicle.manufacturer, vehicle.brand, vehicle.model_code);
  return saved && !saved.startsWith(APPEARANCE_PREFIX) ? saved : null;
}
function assetKey(modelKey?: string | null): string {
  const raw = (modelKey ?? "").replace(/^appearance:/, "");
  return VEHICLE_MAP_MODEL_ALIASES[raw] ?? raw;
}
export function modelUrlFor(modelKey?: string | null): string {
  return VEHICLE_MODEL_URLS[assetKey(modelKey)] ?? VEHICLE_MODEL_URLS[DEFAULT_VEHICLE_MODEL_KEY];
}
export function vehicleMapModelFor(modelKey?: string | null): VehicleMapModel {
  return VEHICLE_MAP_MODELS[assetKey(modelKey)] ?? VEHICLE_MAP_MODELS[DEFAULT_VEHICLE_MAP_MODEL_KEY];
}
export function mapModelLabelFor(modelKey?: string | null): { label: string; isDefault: boolean } {
  const key = assetKey(modelKey);
  return { label: VEHICLE_MAP_MODEL_LABELS[key] ?? "標準の軽バン", isDefault: !VEHICLE_MAP_MODELS[key] };
}
export const KEI_VANS_BY_MANUFACTURER = KEI_VANS.reduce<Record<string, KeiVan[]>>((acc, v) => {
  (acc[v.manufacturer] ??= []).push(v); return acc;
}, {});
export const BODY_COLOR_BASE = [
  { label: "ホワイト", value: "#f1f5f9" }, { label: "シルバー", value: "#c0c6cc" }, { label: "ブラック", value: "#1f2937" },
];
