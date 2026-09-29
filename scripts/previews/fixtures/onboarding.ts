import type { PreviewFixture } from "@/lib/preview/fixtureStore";

export const onboardingFixture: PreviewFixture<Record<string, never>> = {
  id: "onboarding", title: "招待・初期登録", pathname: "/join",
  scenarios: {
    normal: { label: "招待から", description: "架空の招待とSMS認証で登録する" },
    resumed: { label: "登録を再開", description: "未設定のかんたんログインから再開する" },
    incomplete: { label: "SMSから再開", description: "SMSログイン後に登録の続きを表示する" },
    registered: { label: "設定済み", description: "設定済みの人は住所の続きから再開する" },
    unsupported: { label: "非対応", description: "かんたんログインを設定できない端末では先へ進めない" },
    retry: { label: "登録失敗", description: "登録が一度失敗し、再試行で成功する" },
    complete: { label: "申請済み", description: "申請完了・かんたんログイン未設定の状態で再訪する" },
  },
  createState: () => ({}), read: () => undefined, write: () => undefined,
};
