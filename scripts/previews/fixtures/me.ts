import { accountFixture } from "./account";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
export const meFixture: PreviewFixture<ReturnType<typeof accountFixture.createState>> = {
  id: "me", title: "マイページ・ログイン設定", pathname: "/me",
  scenarios: {
    normal: { label: "招待ユーザー", description: "PIN変更を表示せずPasskeyを登録できる" },
    registered: { label: "Passkey登録済み", description: "登録済みの案内を表示する" },
    legacy: { label: "旧PINユーザー", description: "PIN変更を表示しない" },
    lastkey: { label: "最後の鍵", description: "最後の鍵の削除を防ぐ" },
  },
  createState: (context) => accountFixture.createState({ ...context, scenario: context.scenario === "registered" ? "normal" : context.scenario === "normal" ? "empty" : context.scenario }),
  read: (state, request, context) => {
    const { path } = request; const { scenario } = context;
    const shared = accountFixture.read(state, request, context);
    if (shared !== undefined) return shared;
    if (path === "/api/reports/profile") return {
      name: "見本 太郎", officeCode: "TEST", driverCode: "TST123456", displayName: "見本 太郎",
      postalCode: "", address: "", phone: "09000000000", phoneVerified: true,
      hasPasskey: state.hasPasskey, canChangePin: scenario === "legacy", bankName: "", bankNo: "", bankHolder: "",
    };
    if (path === "/api/me/line") return { configured: false, linked: false, linkedAt: null, blocked: false };
    if (path === "/api/me/push") return { configured: false, publicKey: null };
    if (path === "/api/me/registration") return { complete: true, kycVerified: true, hasPasskey: state.hasPasskey };
    return [];
  },
  write: accountFixture.write,
};
