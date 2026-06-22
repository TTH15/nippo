// 車両選択まわりの純粋ロジック（プラットフォーム非依存）。
// id を持つ車両であれば型を問わず使えるよう汎用化（VehiclePlateData / SubmitVehicle 共通）。

type HasId = { id: string };

/** 複数の車両リストを結合し、id で重複排除する（先勝ち）。 */
export function dedupeVehiclesById<T extends HasId>(...lists: T[][]): T[] {
  const all = lists.flat();
  return Array.from(new Map(all.map((v) => [v.id, v] as const)).values());
}

/** 指定 id の車両を除外する（id が null なら素通し）。 */
export function excludeVehicleId<T extends HasId>(list: T[], id: string | null): T[] {
  return list.filter((v) => (id ? v.id !== id : true));
}

/**
 * 既定で選択する車両 id を決める。
 * 優先車両が連携車両に含まれればそれ > 連携車両の先頭 > null。
 */
export function resolvePreferredVehicleId<T extends HasId>(
  linked: T[],
  preferredId: string | null,
): string | null {
  if (preferredId && linked.some((v) => v.id === preferredId)) return preferredId;
  if (linked.length > 0) return linked[0].id;
  return null;
}
