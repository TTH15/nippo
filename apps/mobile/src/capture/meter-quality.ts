export const METER_GUIDES = [
  { id: "center-right", label: "中央1眼・右燃料" },
  { id: "dual-center-fuel", label: "左右2眼・中央燃料" },
  { id: "center-side", label: "中央速度・左右小計器" },
  { id: "single-digital", label: "丸型・燃料表示一体" },
  { id: "triple-center", label: "3連丸型・中央速度" },
  { id: "round", label: "丸型" }, { id: "right", label: "燃料計が右" },
  { id: "left", label: "燃料計が左" }, { id: "wide", label: "横長" }, { id: "generic", label: "汎用" },
] as const;
export type MeterGuide = typeof METER_GUIDES[number]["id"];
export const METER_ISSUES = ["glare", "blur", "cropped", "dark", "trip_only", "uncertain"] as const;
export type MeterIssue = typeof METER_ISSUES[number];
// 数値の確定とは別の撮影品質。両方の表示を確認できた場合だけ合格を表示する。
export type MeterQualityResult = { odometerReadable: boolean; fuelReadable: boolean; issues: MeterIssue[] };
export type MeterQualityState = { status: "idle" } | { status: "checking" } | { status: "unavailable" } | { status: "ready"; result: MeterQualityResult };
export type MeterPhotoAssessor = (uri: string, context: { guide: MeterGuide; signal: AbortSignal }) => Promise<unknown>;
export function parseMeterQuality(value: unknown): MeterQualityResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.odometerReadable !== "boolean" || typeof v.fuelReadable !== "boolean" || !Array.isArray(v.issues) || !v.issues.every(i => METER_ISSUES.includes(i))) return null;
  return { odometerReadable: v.odometerReadable, fuelReadable: v.fuelReadable, issues: v.issues as MeterIssue[] };
}
export async function checkMeterPhoto(uri: string, guide: MeterGuide, assessor?: MeterPhotoAssessor, timeoutMs = 6000): Promise<MeterQualityState> {
  if (!assessor) return { status: "unavailable" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => assessor(uri, { guide, signal: controller.signal })),
      new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); }),
    ]);
    const result = parseMeterQuality(value);
    return result ? { status: "ready", result } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
  finally { clearTimeout(timer); controller.abort(); }
}
export function meterQualityCopy(state: MeterQualityState) {
  const manual = "自動確認を利用できません。走行距離と燃料計の反射・ブレを確認してください。";
  if (state.status === "idle") return { message: "", label: "この写真を使う", warning: false };
  if (state.status === "checking") return { message: "走行距離と燃料計を確認中…", label: "写真を確認中", warning: false };
  if (state.status === "unavailable") return { message: manual, label: "目視で確認して使う", warning: true };
  const { issues, odometerReadable, fuelReadable } = state.result;
  const issue = issues.find(i => i === "glare") ?? issues[0];
  const messages: Record<MeterIssue, string> = {
    glare: "表示に光が反射しています。フラッシュを切り、角度を少し変えて撮り直してください。",
    blur: "表示がぼやけています。スマホを止め、ピントが合ってから撮り直してください。",
    cropped: "表示が切れています。燃料計と走行距離を含め、少し引いて撮り直してください。",
    dark: "表示が暗く写っています。メーターの照明をつけて撮り直してください。",
    trip_only: "走行距離を確認できません。ODO表示に切り替えて撮り直してください。",
    uncertain: "表示を確認しきれません。走行距離と燃料計を確認してください。",
  };
  const message = issue ? messages[issue] : !odometerReadable ? "走行距離を確認できません。表示に近づいて撮り直してください。" : !fuelReadable ? "燃料計を確認できません。燃料計を含めて撮り直してください。" : "走行距離・燃料計の写りを確認しました";
  return { message, label: issue || !odometerReadable || !fuelReadable ? "目視で確認して使う" : "この写真を使う", warning: !!issue || !odometerReadable || !fuelReadable };
}
