// 日報「種別」バッジの表示ヘルパ（動的キャリア対応）。
//   実キャリア名(carrier_name)を表示し、色は既知キャリアのみ固定、その他は中立色。
//   注意: 旧コード carrier は code 未設定の新キャリアで 'YAMATO' に既定化されるため、
//   ラベル・色判定ともに carrier_name を優先する。

/** バッジに出す表示名。carrier_name 優先、無ければ旧コードから推定。 */
export function carrierBadgeLabel(carrier?: string | null, carrierName?: string | null): string {
  const name = carrierName?.trim();
  if (name) return name;
  if (carrier === "AMAZON") return "Amazon";
  if (carrier === "YAMATO") return "ヤマト";
  return carrier?.trim() || "—";
}

/** バッジの配色（Tailwind クラス）。既知キャリアは固定色、新キャリアは sky。 */
export function carrierBadgeTone(
  carrier?: string | null,
  carrierName?: string | null,
  muted?: boolean,
): string {
  if (muted) return "bg-slate-200 text-slate-600";
  const name = carrierName?.trim();
  const isAmazon = carrier === "AMAZON" || name === "Amazon";
  const isYamato = name === "ヤマト" || (carrier === "YAMATO" && !name);
  if (isAmazon) return "bg-violet-100 text-violet-700";
  if (isYamato) return "bg-emerald-100 text-emerald-700";
  return "bg-sky-100 text-sky-700";
}
