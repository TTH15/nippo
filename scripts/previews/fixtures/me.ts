import { accountFixture } from "./account";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
export const meFixture: PreviewFixture<ReturnType<typeof accountFixture.createState> & { phoneVerified: boolean; phoneSent: boolean; bank: { bankName: string; bankNo: string; bankHolder: string }; readAttempts: number }> = {
  id: "me", title: "マイページ・ログイン設定", pathname: "/me",
  scenarios: {
    "both-missing": { label: "両方未完了", description: "SMSと振込口座の両方が必要" },
    "phone-missing": { label: "電話未確認", description: "口座のみ登録済み" },
    "no-phone": { label: "電話番号なし", description: "運営へ登録を依頼" },
    "bank-missing": { label: "口座未登録", description: "電話番号のみ確認済み" },
    "long-name": { label: "長い名前", description: "長い名義・支店名" },
    "refresh-error": { label: "保存後の取得失敗", description: "保存後の再確認が一度失敗し、再読み込みで復帰" },
    normal: { label: "招待ユーザー", description: "PIN変更を表示せず、かんたんログインを設定できる" },
    registered: { label: "設定済み", description: "設定済みの案内を表示する" },
    legacy: { label: "旧PINユーザー", description: "PIN変更を表示しない" },
    lastkey: { label: "最後の鍵", description: "最後の鍵の削除を防ぐ" },
  },
  createState: (context) => ({ ...accountFixture.createState({ ...context, scenario: context.scenario === "registered" ? "normal" : context.scenario === "normal" ? "empty" : context.scenario }),
    phoneVerified: !["both-missing", "phone-missing", "no-phone"].includes(context.scenario), phoneSent: false, readAttempts: 0,
    bank: ["normal", "registered", "phone-missing", "long-name"].includes(context.scenario)
      ? { bankName: context.scenario === "long-name" ? "見本銀行 配送事業者共同営業センター支店" : "見本銀行 中央支店", bankNo: "1234567", bankHolder: context.scenario === "long-name" ? "カブシキガイシャ ミホンハイソウサービス ダイヒョウトリシマリヤク ミホン タロウ" : "ミホン タロウ" }
      : { bankName: "", bankNo: "", bankHolder: "" },
  }),
  read: (state, request, context) => {
    const { path } = request; const { scenario } = context;
    const shared = accountFixture.read(state, request, context);
    if (shared !== undefined) return shared;
    if (path === "/api/reports/profile") return {
      name: "見本 太郎", officeCode: "TEST", driverCode: "TST123456", displayName: "見本 太郎",
      postalCode: "", address: "", phone: scenario === "no-phone" ? "" : "09000000000", phoneVerified: state.phoneVerified,
      hasPasskey: state.hasPasskey, canChangePin: scenario === "legacy", ...state.bank,
    };
    if (path === "/api/me/line") return { configured: false, linked: false, linkedAt: null, blocked: false };
    if (path === "/api/me/push") return { configured: false, publicKey: null };
    if (path === "/api/me/registration") {
      if (scenario === "refresh-error" && state.bank.bankNo && state.readAttempts++ === 0) throw new Error("登録状況の再確認に失敗しました");
      return { complete: true, kycVerified: true, hasPasskey: state.hasPasskey, ...state.bank };
    }
    return [];
  },
  write: (state, request, context) => {
    if (request.path === "/api/me/phone/send") {
      if (state.phoneVerified || request.body.phone !== "09000000000") throw new Error("登録済みの電話番号を確認してください");
      state.phoneSent = true; return { ok: true };
    }
    if (request.path === "/api/me/phone/verify") {
      if (!state.phoneSent || request.body.code !== "123456") throw new Error("認証コードが正しくありません");
      state.phoneVerified = true; state.phoneSent = false; return { ok: true };
    }
    if (request.path === "/api/me/registration") {
      const { bankName, bankNo, bankHolder } = request.body;
      if (typeof bankName !== "string" || typeof bankNo !== "string" || typeof bankHolder !== "string") throw new Error("振込口座を入力してください");
      state.bank = { bankName, bankNo, bankHolder }; return { ok: true };
    }
    return accountFixture.write?.(state, request, context);
  },
};
