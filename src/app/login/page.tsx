"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setAuth } from "@/lib/api";
import { getCompany } from "@/config/companies";

type LoginType = "driver" | "admin";

export default function LoginPage() {
  const router = useRouter();
  const [loginType, setLoginType] = useState<LoginType>("driver");
  const [driverCode, setDriverCode] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const company = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const body = loginType === "driver"
        ? { loginType: "driver", driverCode: driverCode.toUpperCase() }
        : { loginType: "admin", companyCode: companyCode.toUpperCase(), pin };

      const res = await apiFetch<{
        token: string;
        driver: { id: string; name: string; role: string; companyCode?: string };
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setAuth(res.token, res.driver);

      if (res.driver.role === "ADMIN") {
        router.push("/admin");
      } else {
        router.push("/submit");
      }
    } catch (err: unknown) {
      let errorMessage = "ログインに失敗しました";
      if (err instanceof Error) {
        errorMessage = err.message;
        // より分かりやすいエラーメッセージに変換
        if (errorMessage.includes("ドライバーコード")) {
          errorMessage = errorMessage;
        } else if (errorMessage.includes("無効な")) {
          errorMessage = "ドライバーコードまたはPINが正しくありません";
        } else if (errorMessage.includes("認証")) {
          errorMessage = "認証に失敗しました。ドライバーコードの数字6桁部分を確認してください";
        }
      }
      setError(errorMessage);
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  const isValid = loginType === "driver" 
    ? driverCode.length === 9 
    : companyCode.length === 3 && pin.length >= 4;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          {/* Header */}
          <div className="p-5 border-b border-slate-200">
            <h1 className="text-xl font-bold text-slate-900 text-center">日報集計</h1>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            <button
              type="button"
              onClick={() => { setLoginType("driver"); setError(""); }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                loginType === "driver"
                  ? "text-slate-900 border-b-2 border-slate-900"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              ドライバー
            </button>
            <button
              type="button"
              onClick={() => { setLoginType("admin"); setError(""); }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                loginType === "admin"
                  ? "text-slate-900 border-b-2 border-slate-900"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              管理者
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {loginType === "driver" ? (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  ドライバーコード
                </label>
                <input
                  type="text"
                  maxLength={9}
                  placeholder={`${company.code}111111`}
                  value={driverCode}
                  onChange={(e) => {
                    // アルファベットと数字のみ許可
                    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    setDriverCode(val);
                  }}
                  className="w-full text-center text-lg tracking-wider font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors uppercase"
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  会社コード3文字（例: {company.code}）+ 個人番号6桁（例: 111111）
                </p>
                {driverCode.length > 0 && driverCode.length < 9 && (
                  <p className="text-xs text-amber-600 mt-1">
                    {9 - driverCode.length}文字不足しています
                  </p>
                )}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    会社コード
                  </label>
                  <input
                    type="text"
                    maxLength={3}
                    placeholder={`例: ${company.code}`}
                    value={companyCode}
                    onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
                    className="w-full text-center text-lg tracking-wider font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors uppercase"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="管理者PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full text-center text-lg tracking-wider font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors"
                  />
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-red-600 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !isValid}
              className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
