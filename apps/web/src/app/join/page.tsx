"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

// ============================================================
// 公開・参加申請ページ（仮登録）。認証不要。
// step1 参加コード→会社名確認 / step2 氏名＋電話→SMS OTP送信 / step3 コード→申請 → 承認待ち。
// 重い PII（免許等）は本登録（承認後）。ここは氏名＋電話(OTP)のみ。
// ============================================================

type Step = "code" | "info" | "otp" | "done";

export default function JoinPage() {
  const [step, setStep] = useState<Step>("code");
  const [joinCode, setJoinCode] = useState("");
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ organizationName: string }>(
        `/api/join/lookup?code=${encodeURIComponent(joinCode.trim().toUpperCase())}`,
      );
      setOrgName(res.organizationName);
      setStep("info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "参加コードが確認できませんでした");
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async () => {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/otp/send", { method: "POST", body: JSON.stringify({ phone: phone.trim() }) });
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "認証コードの送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/join", {
        method: "POST",
        body: JSON.stringify({
          joinCode: joinCode.trim().toUpperCase(),
          name: name.trim(),
          phone: phone.trim(),
          code: code.trim(),
        }),
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "申請に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors";
  const btnCls =
    "w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="p-3 border-b border-slate-200 flex flex-col items-center">
            <img src="/logo/hakotora-logo_secondary_logo.svg" alt="ロゴ" className="h-12 mb-2" style={{ maxWidth: "60%", height: "auto" }} />
            <h1 className="text-base font-semibold text-slate-900">参加申請</h1>
          </div>

          <div className="p-5 space-y-4">
            {step === "code" && (
              <>
                <p className="text-sm text-slate-600">運営から受け取った参加コードを入力してください。</p>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
                  className="w-full text-center text-lg tracking-widest font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                  placeholder="ABC123"
                  autoFocus
                  autoComplete="off"
                />
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={lookup} disabled={loading || joinCode.trim().length < 4} className={btnCls}>
                  {loading ? "確認中..." : "確認"}
                </button>
              </>
            )}

            {step === "info" && (
              <>
                <p className="text-sm text-slate-700">
                  <span className="font-bold">{orgName}</span> に参加を申請します。
                </p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">氏名</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="山田 太郎" autoComplete="name" autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">電話番号</label>
                  <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="090-1234-5678" autoComplete="tel" />
                  <p className="text-xs text-slate-400 mt-1">この番号に SMS で認証コードを送ります。アカウント復旧にも使います。</p>
                </div>
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={sendCode} disabled={loading || !name.trim() || !phone.trim()} className={btnCls}>
                  {loading ? "送信中..." : "認証コードを送信"}
                </button>
                <button onClick={() => { setStep("code"); setError(""); }} className="w-full text-sm text-slate-500 hover:text-slate-700">
                  ‹ コードを入れ直す
                </button>
              </>
            )}

            {step === "otp" && (
              <>
                <p className="text-sm text-slate-600">{phone} に送った6桁の認証コードを入力してください。</p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full text-center text-2xl tracking-[0.5em] font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                  placeholder="______"
                  maxLength={6}
                  autoFocus
                />
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={submit} disabled={loading || code.length !== 6} className={btnCls}>
                  {loading ? "申請中..." : "申請する"}
                </button>
                <button onClick={sendCode} disabled={loading} className="w-full text-sm text-blue-600 hover:text-blue-800">
                  コードを再送する
                </button>
              </>
            )}

            {step === "done" && (
              <div className="text-center space-y-3 py-2">
                <p className="text-base font-semibold text-slate-900">申請を受け付けました</p>
                <p className="text-sm text-slate-600">
                  「{orgName}」の運営による承認をお待ちください。
                  <br />
                  承認されると、運営からドライバーコードと初期PINが連絡されます。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
