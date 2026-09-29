// Expo Camera 57のiOS実装はlocalizedNameを返す。列挙された名称だけを選択する。
export function captureLenses(lenses: string[]) {
  const ultra = lenses.find(name => /ultra[ -]?wide|超広角/i.test(name));
  const standard = lenses.find(name => !/ultra|超広角|dual|triple|デュアル|トリプル/i.test(name) && /wide|広角/i.test(name));
  return { ultra, standard };
}
export type PhotoAssessment = { blur?: boolean; framing?: boolean; glare?: boolean; passed?: boolean };
// 省略された値や警告なしだけでは合格としない。判定器が明示的に合格を返した場合だけ進める。
export function canAutoAdvancePhoto(value: PhotoAssessment | null) {
  return value?.passed === true && !value.blur && !value.framing && !value.glare;
}
export function photoAssessmentMessage(value: PhotoAssessment | null) {
  if (value?.glare) return "光が反射しています。フラッシュを切り、角度を変えて撮り直してください。";
  if (value?.framing) return "車体が切れている可能性があります。全体を入れて撮り直してください。";
  if (value?.blur) return "写真がぶれている可能性があります。スマホを止めて撮り直してください。";
  return null;
}
