"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startAuthentication } from "@simplewebauthn/browser";
import { apiFetch, setAuth, getStoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
import { getLastAppMode, isMobileWidth, resolveHomePath } from "@/lib/appMode";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentSms, faFingerprint } from "@fortawesome/free-solid-svg-icons";

type LoginResult = {
  token: string;
  driver: { id: string; name: string; role: string; companyCode?: string };
};

export default function LoginPage() {
  const router = useRouter();
  const canUsePasskey = useIsWebAuthnHost();
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");

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
              <h1 className="text-base font-semibold text-slate-900 text-center">ログイン</h1>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {canUsePasskey && <>
              <button type="button" onClick={handlePasskeyLogin} disabled={passkeyLoading}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                <FontAwesomeIcon icon={faFingerprint} className="h-4 w-4" />
                {passkeyLoading ? "確認中..." : "Passkeyでログイン"}
              </button>
              {passkeyError && <p role="alert" className="text-sm text-red-600">{passkeyError}</p>}
            </>}
            <Link href="/login/recover"
              className="flex min-h-11 w-full flex-col items-center rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-center hover:bg-slate-50">
              <span className="flex items-center gap-2 font-medium text-slate-900">
                <FontAwesomeIcon icon={faCommentSms} className="h-4 w-4" />電話番号でログイン
              </span>
              <span className="mt-1 text-xs text-slate-500">初めての方・Passkeyを使えない方</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
