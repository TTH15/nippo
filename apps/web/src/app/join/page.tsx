"use client";

import { OnboardingWizard } from "./OnboardingWizard";

// ============================================================
// 初期登録の入口（本番）。ウィザード本体とAPIは OnboardingWizard.tsx を参照。
// UIUX の調整は /preview/onboarding（モック・SMS/DB なし）で反復できる。
// ============================================================

export default function JoinPage() {
  return <OnboardingWizard />;
}
