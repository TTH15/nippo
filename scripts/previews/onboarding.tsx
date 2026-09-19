import { useMemo } from "react";
import { OnboardingWizard, type Reg, type WizardAdapter } from "@/app/join/OnboardingWizard";
import { ScenarioBar } from "./kernel/AdminLayout";
import { usePreviewRuntime } from "./kernel/runtime";

export default function OnboardingPreview() {
  const { store } = usePreviewRuntime();
  const scenario = store.scenario;
  const adapter = useMemo<WizardAdapter>(() => {
    const reg: Reg & { hasPasskey: boolean } = {
      name: "見本 太郎", dob: "1995-04-02", licenseExpiry: "", hasLicensePhoto: false,
      hasFacePhoto: false, postalCode: "", address: "", bankName: "", bankNo: "", bankHolder: "",
      complete: false, kycVerified: false, hasPasskey: scenario === "registered",
    };
    if (scenario === "complete") Object.assign(reg, {
      licenseExpiry: "2030-04-02", hasLicensePhoto: true, hasFacePhoto: true,
      postalCode: "1000001", address: "東京都千代田区千代田1", complete: true,
    });
    let attempts = 0;
    return {
      lookupInvite: async () => ({ organizationName: "プレビュー運送" }),
      lookupCode: async () => ({ organizationName: "プレビュー運送" }),
      tryResume: async () => {
        if (scenario === "loading") return new Promise(() => {});
        if (scenario === "error") throw new Error("登録内容を読み込めませんでした");
        return scenario === "normal" ? null : { ...reg };
      },
      sendOtp: async () => {},
      join: async () => ({ alreadyApplied: false, reg: { ...reg } }),
      registerPasskey: async () => {
        if (scenario === "retry" && attempts++ === 0) throw new Error("登録できませんでした");
        reg.hasPasskey = true;
      },
      getRegistration: async () => ({ ...reg }),
      saveRegistration: async (fields) => { Object.assign(reg, fields); },
      uploadPhoto: async (kind) => { if (kind === "license") reg.hasLicensePhoto = true; else reg.hasFacePhoto = true; },
    };
  }, [scenario]);
  return <><div className="p-3"><ScenarioBar /></div><OnboardingWizard adapter={adapter}
    passkeyOverride={scenario !== "unsupported"} initialInvite="preview-invite" persistDraft={false} /></>;
}
