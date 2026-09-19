import type { PreviewFixture } from "@/lib/preview/fixtureStore";

export const onboardingFixture: PreviewFixture<Record<string, never>> = {
  id: "onboarding", title: "招待・初期登録", pathname: "/join",
  scenarios: {
    normal: { label: "招待から", description: "架空の招待とSMS認証で登録する" },
    resumed: { label: "登録を再開", description: "未登録のPasskey設定から再開する" },
    incomplete: { label: "SMSから再開", description: "SMSログイン後に登録の続きを表示する" },
    registered: { label: "Passkey登録済み", description: "登録済みの人は住所の続きから再開する" },
    unsupported: { label: "非対応", description: "Passkeyを設定できない端末でSMSを選ぶ" },
    retry: { label: "登録失敗", description: "登録が一度失敗し、再試行で成功する" },
    complete: { label: "申請済み", description: "申請完了・Passkey未登録の状態で再訪する" },
  },
  createState: () => ({}), read: () => undefined, write: () => undefined,
};
