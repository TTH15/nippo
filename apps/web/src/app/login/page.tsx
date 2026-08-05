"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startAuthentication } from "@simplewebauthn/browser";
import { apiFetch, setAuth, getStoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
import { getLastAppMode, isMobileWidth, resolveHomePath } from "@/lib/appMode";
import { getCompany } from "@/config/companies";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentSms } from "@fortawesome/free-solid-svg-icons";

type LoginResult = {
  token: string;
  driver: { id: string; name: string; role: string; companyCode?: string };
};

export default function LoginPage() {
  const router = useRouter();
  const canUsePasskey = useIsWebAuthnHost();
  const [driverCode, setDriverCode] = useState("");
  const [driverPin, setDriverPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");
  const [needsPhoneLogin, setNeedsPhoneLogin] = useState(false);
  const company = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE);

  const goToHome = (driver: LoginResult["driver"]) => {
    // 判定は app/page.tsx と共通。role 直判定ではカスタムロール（配車担当など）が
    // ドライバー画面へ落ちてしまうため canEnterAdmin に揃える。
    // setAuth 済みなので capabilities はキャッシュから読める。
    router.push(
      resolveHomePath({
        hasAdminAccess: canEnterAdmin(getStoredDriver() ?? driver),
        lastMode: getLastAppMode(),
        isMobile: isMobileWidth(),
      }),
    );
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    setPasskeyError("");
    try {
      const { options, challengeToken } = await apiFetch<{
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        challengeToken: string;
      }>(
        "/api/auth/webauthn/login/options",
        { method: "POST" },
        { skipAuthRedirect: true },
      );

      const authResponse = await startAuthentication({ optionsJSON: options });

      const res = await apiFetch<LoginResult>(
        "/api/auth/webauthn/login/verify",
        {
          method: "POST",
          body: JSON.stringify({ response: authResponse, challengeToken }),
        },
        { skipAuthRedirect: true },
      );

      setAuth(res.token, res.driver);
      goToHome(res.driver);
    } catch (err: unknown) {
      // ユーザーがブラウザのPasskeyダイアログをキャンセルした場合は無言で戻す
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setPasskeyError(err.message || "Passkeyでのログインに失敗しました");
      }
      console.error("Passkey login error:", err);
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNeedsPhoneLogin(false);

    try {
      const digits6 = driverCode.replace(/\D/g, "").slice(0, 6);
      const normalizedCode = `${company.code}${digits6}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const body = {
        loginType: "driver" as const,
        driverCode: normalizedCode,
        pin: driverPin,
      };

      const res = await apiFetch<{
        token: string;
        driver: { id: string; name: string; role: string; companyCode?: string };
      }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        { skipAuthRedirect: true }, // 資格情報の誤り(401)は /login へ飛ばさず文言表示
      );

      setAuth(res.token, res.driver);
      goToHome(res.driver);
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
      // PINレスのアカウント（招待リンク経由）は、この画面では二度と成功しない。
      // 文言を出すだけでは行き止まりなので、その場に電話番号ログインの導線を出す。
      setNeedsPhoneLogin(errorMessage.includes("PINを使いません"));
      setError(errorMessage);
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  const isValid = driverCode.length === 6 && driverPin.length === 6;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          {/* Header */}
          <div className="p-3 border-b border-slate-200">
            <div className="flex flex-col items-center">
              <img
                src="/logo/hakotora-logo_secondary_logo.svg"
                alt="ハコ虎 ロゴ"
                className="h-12 mb-2"
                style={{ maxWidth: '60%', height: 'auto' }}
              />
              <h1 className="text-xl font-bold text-slate-900 text-center"></h1>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                会社コード + ドライバー番号
              </label>
              <div className="flex">
                <span
                  className="inline-flex items-center px-4 py-2.5 border border-r-0 border-slate-200 bg-slate-50 rounded-l-lg text-lg font-mono text-slate-600 select-none"
                  style={{ minWidth: 70 }}
                >
                  {company.code || "会社コード"}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={driverCode}
                  onChange={(e) => {
                    // 入力は数字6桁のみ許可
                    const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
                    setDriverCode(val);
                  }}
                  className="w-full text-center text-lg tracking-wider font-mono py-2.5 px-4 border border-slate-200 rounded-r-lg focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="123456"
                  autoFocus
                  autoComplete="off"
                />
              </div>
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
              <div className="space-y-2">
                <p className="text-sm text-red-600 text-center">{error}</p>
                {needsPhoneLogin && (
                  <Link
                    href="/login/recover"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    <FontAwesomeIcon icon={faCommentSms} className="h-4 w-4" />
                    電話番号でログイン
                  </Link>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !isValid}
              className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
          </form>

          <div className="px-5 pb-5">
            {canUsePasskey && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400">または</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                {passkeyError && (
                  <p className="text-sm text-red-600 text-center mb-2">{passkeyError}</p>
                )}
                <button
                  type="button"
                  onClick={handlePasskeyLogin}
                  disabled={passkeyLoading}
                  className="w-full py-2.5 bg-white text-slate-900 font-medium rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {passkeyLoading ? "確認中..." : "Passkeyでログイン"}
                </button>
              </>
            )}
            {/* 招待リンクから入った人は PIN を持たない（§2-1a）。電話番号ログインは
                「困った人向けの補助」ではなく**主要な入口のひとつ**なので、
                薄いテキストリンクではなく Passkey と同格のボタンで出す（2026-08-05 指摘） */}
            {!canUsePasskey && (
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">または</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            <Link
              href="/login/recover"
              className="mt-3 flex w-full flex-col items-center rounded-lg border border-slate-300 bg-white py-2.5 transition-colors hover:bg-slate-50"
            >
              <span className="flex items-center gap-2 font-medium text-slate-900">
                <FontAwesomeIcon icon={faCommentSms} className="h-4 w-4 text-slate-500" />
                電話番号でログイン
              </span>
              <span className="mt-0.5 text-xs text-slate-500">
                初めての方・機種変更・PIN / Passkey を忘れた方
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
