"use client";

import { useMemo, useState } from "react";
import { OnboardingWizard, type Reg, type WizardAdapter } from "@/app/join/OnboardingWizard";

// ============================================================
// 初期登録ウィザードのプレビュー（開発用・認証不要）。
// モック adapter を注入して SMS・DB・Passkey なしで全ステップを何度でも通せる。
// - SMS: 送信されない。認証コードは任意の6桁で通る
// - 写真: アップロードされない（プレビュー表示のみ）
// - Face ID: 疑似成功（0.9秒）。「失敗を再現」ON でキャンセル時の挙動を確認できる
// - 通信遅延を疑似再現（各操作 0.3〜0.9 秒）
// 本番の UI 実装は共有（apps/web/src/app/join/OnboardingWizard.tsx）なので、
// ここで見た目・文言・遷移を調整すれば /join にそのまま反映される。
// ============================================================

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const emptyReg = (): Reg => ({
  name: "",
  dob: "",
  licenseExpiry: "",
  hasLicensePhoto: false,
  hasFacePhoto: false,
  postalCode: "",
  address: "",
  bankName: "",
  bankNo: "",
  bankHolder: "",
  complete: false,
  kycVerified: false,
});

function createMockAdapter(opts: { failPasskey: boolean }): WizardAdapter {
  const reg = emptyReg();
  const recompute = () => {
    reg.complete =
      reg.hasLicensePhoto && reg.hasFacePhoto && !!reg.licenseExpiry && !!reg.postalCode && !!reg.address;
  };
  return {
    async lookupInvite() {
      await delay(400);
      return { organizationName: "プレビュー運送株式会社" };
    },
    async lookupCode() {
      await delay(400);
      return { organizationName: "プレビュー運送株式会社" };
    },
    async tryResume() {
      return null; // プレビューは常に最初から
    },
    async sendOtp() {
      await delay(600);
    },
    async join(payload) {
      await delay(800);
      reg.name = payload.name;
      reg.dob = payload.dob;
      return { alreadyApplied: false, reg: { ...reg } };
    },
    async registerPasskey() {
      await delay(900);
      if (opts.failPasskey) {
        const err = new Error("NotAllowedError");
        err.name = "NotAllowedError";
        throw err;
      }
    },
    async getRegistration() {
      await delay(300);
      recompute();
      return { ...reg };
    },
    async saveRegistration(fields) {
      await delay(300);
      Object.assign(reg, fields);
      recompute();
    },
    async uploadPhoto(kind) {
      await delay(500);
      if (kind === "license") reg.hasLicensePhoto = true;
      else reg.hasFacePhoto = true;
    },
  };
}

export default function OnboardingPreviewPage() {
  const [run, setRun] = useState(0); // インクリメントで key が変わりウィザードを初期化
  const [entry, setEntry] = useState<"invite" | "code">("invite");
  const [failPasskey, setFailPasskey] = useState(false);
  // run のたびに新しいモック状態を作る（前回の入力を持ち越さない）。
  const adapter = useMemo(
    () => createMockAdapter({ failPasskey }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, failPasskey],
  );

  const chipCls = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
      active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="min-h-screen bg-slate-100">
      {/* プレビュー操作バー */}
      <div className="sticky top-0 z-10 bg-amber-50 border-b border-amber-200 px-4 py-2.5">
        <div className="max-w-2xl mx-auto flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-amber-800">プレビュー（SMS送信なし・データ保存なし）</span>
          <span className="text-xs text-amber-700">認証コードは任意の6桁でOK</span>
          <div className="flex items-center gap-2 ml-auto">
            <button className={chipCls(entry === "invite")} onClick={() => { setEntry("invite"); setRun((n) => n + 1); }}>
              招待リンクで開始
            </button>
            <button className={chipCls(entry === "code")} onClick={() => { setEntry("code"); setRun((n) => n + 1); }}>
              コード手入力で開始
            </button>
            <button className={chipCls(failPasskey)} onClick={() => { setFailPasskey((v) => !v); setRun((n) => n + 1); }}>
              Face ID 失敗を再現{failPasskey ? ": ON" : ""}
            </button>
            <button
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
              onClick={() => setRun((n) => n + 1)}
            >
              ↺ 最初からやり直す
            </button>
          </div>
        </div>
      </div>

      <OnboardingWizard
        key={`${run}-${entry}-${failPasskey}`}
        adapter={adapter}
        passkeyOverride={true}
        initialInvite={entry === "invite" ? "preview-token" : undefined}
        persistDraft={false}
      />
    </div>
  );
}
