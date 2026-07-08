"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setAuth } from "@/lib/api";

// ============================================================
// 公開・アカウント復旧ページ。認証不要。
// Passkey/PINを共に失った場合に、登録済みの電話番号へのSMS OTPで本人確認しログインする。
// ログイン後は /me へ遷移し、その場で新しい端末にPasskeyを登録し直せる。
// ============================================================

type Step = "phone" | "otp";

export default function RecoverPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setLoading(true);
    setError("");
    try {
      await apiFetch(
        "/api/otp/send",
        { method: "POST", body: JSON.stringify({ phone: phone.trim() }) },
        { skipAuthRedirect: true },
      );
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "認証コードの送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{
        token: string;
        driver: { id: string; name: string; role: string; companyCode?: string };
      }>(
        "/api/auth/recover/verify",
        { method: "POST", body: JSON.stringify({ phone: phone.trim(), code: code.trim() }) },
        { skipAuthRedirect: true },
      );
      setAuth(res.token, res.driver);
      router.push(res.driver.role === "ADMIN" ? "/admin" : "/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "確認に失敗しました");
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
            <img
              src="/logo/hakotora-logo_secondary_logo.svg"
              alt="ロゴ"
              className="h-12 mb-2"
              style={{ maxWidth: "60%", height: "auto" }}
            />
            <h1 className="text-base font-semibold text-slate-900">アカウントの復旧</h1>
          </div>

          <div className="p-5 space-y-4">
            {step === "phone" && (
              <>
                <p className="text-sm text-slate-600">
                  登録済みの電話番号にSMSで認証コードを送ります。
                </p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">電話番号</label>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputCls}
                    placeholder="090-1234-5678"
                    autoComplete="tel"
                    autoFocus
                  />
                </div>
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={sendCode} disabled={loading || !phone.trim()} className={btnCls}>
                  {loading ? "送信中..." : "認証コードを送信"}
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
                <button onClick={verify} disabled={loading || code.length !== 6} className={btnCls}>
                  {loading ? "確認中..." : "ログインする"}
                </button>
                <button onClick={sendCode} disabled={loading} className="w-full text-sm text-blue-600 hover:text-blue-800">
                  コードを再送する
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
