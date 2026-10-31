/** Web共通の動き。用途と運用ルールは docs/hakotora-design-system.md を参照。 */
export const disclosureTransition = {
  duration: 0.25,
  ease: [0.22, 1, 0.36, 1] as const,
};

/** ツールバー直下など、内容をすぐ確認したい短い開閉に使う。 */
export const quickDisclosureTransition = {
  duration: 0.14,
  ease: [0.22, 1, 0.36, 1] as const,
};

export const reorderTransition = {
  type: "spring" as const,
  stiffness: 420,
  damping: 32,
  mass: 0.8,
};

export const instantTransition = { duration: 0 };

/** 電話番号の確認済み表示を見せてから次の入力へ進む。 */
export const setupConfirmationDelayMs = 650;

/** PCログイン入口の左右パネル切替。 */
export const loginSceneTransition = {
  duration: 0.62,
  ease: [0.22, 1, 0.36, 1] as const,
};

/** 表を動かさない表示設定と半月切替。 */
export const controlPopoverMotion = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const, scale: 0.98, cssEase: "cubic-bezier(0.22, 1, 0.36, 1)" };
