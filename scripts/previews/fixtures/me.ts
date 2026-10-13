import { normalizeBankAccount, requiresBankChangePasskey, bankFields, type BankAccount } from "@/lib/bankAccount";
import { accountFixture } from "./account";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
export const meFixture: PreviewFixture<ReturnType<typeof accountFixture.createState> & { phoneVerified: boolean; phoneSent: boolean; bank: BankAccount; readAttempts: number; writeAttempts: number; phone: string; pendingPhone: string; bankProof: string | null; proofAttempts: number }> = {
  id: "me", title: "マイページ・ログイン設定", pathname: "/me",
  scenarios: {
    "both-missing": { label: "両方未完了", description: "SMSと振込口座の両方が必要" },
    "phone-missing": { label: "電話未確認", description: "口座のみ登録済み" },
    "no-phone": { label: "電話番号なし", description: "番号を入力してSMSで初回確認" },
    "bank-missing": { label: "口座未登録", description: "電話番号のみ確認済み" },
    "long-name": { label: "長い名前", description: "長い名義・支店名" },
    "save-error": { label: "保存失敗", description: "最初の口座保存だけ失敗し、再保存で復帰" },
    "refresh-error": { label: "保存後の取得失敗", description: "保存後の再確認が一度失敗し、再読み込みで復帰" },
    normal: { label: "通常", description: "口座変更にパスキーで本人確認" },
    "bank-no-passkey": { label: "パスキーなし", description: "変更はパスキー設定後" },
    "bank-passkey-cancel": { label: "パスキー中止", description: "初回のパスキー操作を中止し、再試行できる" },
    "bank-passkey-error": { label: "パスキー確認失敗", description: "初回の確認が失敗し、再試行で復帰" },
    "bank-expired": { label: "確認期限切れ", description: "確認情報の期限切れで変更を拒否" },
    "bank-conflict": { label: "他端末の変更", description: "先に他端末が変更し、上書きを拒否" },
    "bank-change-error": { label: "口座変更失敗", description: "確認後の保存失敗・再確認" },
    registered: { label: "設定済み", description: "設定済みの案内を表示する" },
    legacy: { label: "旧PINユーザー", description: "PIN変更を表示しない" },
    lastkey: { label: "最後の鍵", description: "最後の鍵の削除を防ぐ" },
  },
  createState: (context) => ({ ...accountFixture.createState({ ...context, scenario: context.scenario === "bank-no-passkey" ? "empty" : "normal" }),
    phoneVerified: !["both-missing", "phone-missing", "no-phone"].includes(context.scenario), phoneSent: false, readAttempts: 0, writeAttempts: 0, phone: ["both-missing", "phone-missing", "no-phone"].includes(context.scenario) ? "" : "09000000000", pendingPhone: "", bankProof: null, proofAttempts: 0,
    bank: (["normal", "registered", "phone-missing", "long-name", "bank-no-passkey", "bank-passkey-error", "bank-passkey-cancel", "bank-expired", "bank-conflict", "bank-change-error"].includes(context.scenario)
      ? { bankName: "見本銀行", bankBranch: context.scenario === "long-name" ? "配送事業者共同営業センター支店" : "中央支店", bankType: "ordinary", bankNo: "1234567", bankHolder: context.scenario === "long-name" ? "カブシキガイシャ ミホンハイソウサービス ダイヒョウトリシマリヤク ミホン タロウ" : "ミホン タロウ" }
      : { bankName: "", bankNo: "", bankHolder: "" }) as BankAccount,
  }),
  read: (state, request, context) => {
    const { path } = request; const { scenario } = context;
    const shared = accountFixture.read(state, request, context);
    if (shared !== undefined) return shared;
    if (path === "/api/reports/profile") return {
      name: "見本 太郎", officeCode: "TEST", driverCode: "TST123456", displayName: "見本 太郎",
      postalCode: "", address: "", phone: state.phone, phoneVerified: state.phoneVerified,
      hasPasskey: state.hasPasskey, canChangePin: scenario === "legacy", ...state.bank,
    };
    if (path === "/api/me/line") return { configured: false, linked: false, linkedAt: null, blocked: false };
    if (path === "/api/me/push") return { configured: false, publicKey: null };
    if (path === "/api/me/registration") {
      if (scenario === "refresh-error" && state.bank.bankNo && state.readAttempts++ < 2) throw new Error("登録状況の再確認に失敗しました");
      return { complete: true, kycVerified: true, hasPasskey: state.hasPasskey, ...state.bank };
    }
    return [];
  },
  write: (state, request, context) => {
    if (request.path === "/api/me/phone/send") {
      if (state.phoneVerified || typeof request.body.phone !== "string" || !/^0[0-9-]{9,13}$/.test(request.body.phone) || (state.phone && request.body.phone.replace(/-/g, "") !== state.phone)) throw new Error("登録済みの電話番号を確認してください");
      state.phoneSent = true; state.pendingPhone = String(request.body.phone).replace(/-/g, ""); return { ok: true };
    }
    if (request.path === "/api/me/phone/verify") {
      if (!state.phoneSent || request.body.code !== "123456" || String(request.body.phone).replace(/-/g, "") !== state.pendingPhone) throw new Error("認証コードが正しくありません");
      state.phone = state.pendingPhone; state.phoneVerified = true; state.phoneSent = false; return { ok: true };
    }
    if (request.path.startsWith("/api/auth/reauth/") && request.body.action === "bank_change") {
      if (!state.hasPasskey || request.body.method !== "passkey") throw new Error("パスキーの設定が必要です");
      const target = normalizeBankAccount(request.body.bank);
      if (!target) throw new Error("振込口座を入力してください");
      if (request.path.endsWith("/options")) {
        if (context.scenario === "bank-conflict" && state.proofAttempts++ === 0) { state.bank.bankNo = "7777777"; throw new Error("振込口座が変更されています。登録内容を読み込み直してください"); }
        const visible = request.body.previousBank as Record<string, string> | undefined;
        if (!visible || bankFields.some(key => (visible[key] ?? "") !== (state.bank[key] ?? ""))) throw new Error("振込口座が変更されています。登録内容を読み込み直してください");
        return { options: { previewCancel: context.scenario === "bank-passkey-cancel" && state.proofAttempts++ === 0 }, challengeToken: "preview-bank-challenge" };
      }
      if (context.scenario === "bank-passkey-error" && state.proofAttempts++ === 0) throw new Error("パスキーの確認を完了できませんでした。もう一度お試しください");
      state.bankProof = JSON.stringify(target);
      return { bankChangeToken: "preview-bank-change-proof" };
    }
    if (request.path === "/api/me/registration") {
      if (context.scenario === "save-error" && state.writeAttempts++ === 0) throw new Error("保存できませんでした。入力を残したまま再度保存してください");
      const target = normalizeBankAccount(request.body);
      if (!target) throw new Error("振込口座を入力してください");
      if (requiresBankChangePasskey(state.bank, target)) {
        if (request.headers.get("x-bank-change-token") !== "preview-bank-change-proof" || state.bankProof !== JSON.stringify(target)) throw new Error("振込口座の変更にはパスキーで本人確認が必要です");
        state.bankProof = null;
        if (context.scenario === "bank-expired" && state.writeAttempts++ === 0) throw new Error("本人確認の期限が切れました。パスキーでもう一度確認してください");
        if (context.scenario === "bank-change-error" && state.writeAttempts++ === 0) throw new Error("変更できませんでした。入力を残したまま再度お試しください");
      }
      state.bank = target; return { ok: true };
    }
    return accountFixture.write?.(state, request, context);
  },
};
