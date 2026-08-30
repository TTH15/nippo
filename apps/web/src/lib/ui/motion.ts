/** Web共通の動き。用途と運用ルールは docs/hakotora-design-system.md を参照。 */
export const disclosureTransition = {
  duration: 0.25,
  ease: [0.22, 1, 0.36, 1] as const,
};

export const reorderTransition = {
  type: "spring" as const,
  stiffness: 420,
  damping: 32,
  mass: 0.8,
};

export const instantTransition = { duration: 0 };
