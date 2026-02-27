"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setAuth } from "@/lib/api";
import { getCompany } from "@/config/companies";

export default function LoginPage() {
  const router = useRouter();
  const [driverCode, setDriverCode] = useState("");
  const [driverPin, setDriverPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const company = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const normalizedCode = driverCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const body = {
        loginType: "driver" as const,
        driverCode: normalizedCode,
        pin: driverPin,
      };

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

  const cleanedCode = driverCode.replace(/[^A-Za-z0-9]/g, "");
  const isValid = cleanedCode.length === 9 && driverPin.length === 6;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          {/* Header */}
          <div className="p-5 border-b border-slate-200">
            <h1 className="text-xl font-bold text-slate-900 text-center">日報集計</h1>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                ドライバーコード
              </label>
              <input
                type="text"
                maxLength={9}
                value={driverCode}
                onChange={(e) => {
                  setDriverCode(e.target.value);
                }}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
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
                maxLength={6}
                value={driverPin}
                onChange={(e) =>
                  setDriverPin(e.target.value.replace(/[^0-9]/g, ""))
                }
                className="w-full text-center text-lg tracking-wider font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors"
              />
            </div>

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
