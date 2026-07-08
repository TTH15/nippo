"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch, getStoredDriver, type StoredDriver } from "@/lib/api";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";

export default function AdminAccountPage() {
  const canUsePasskey = useIsWebAuthnHost();
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setDriver(getStoredDriver());
  }, []);

  const handlePasskeyRegister = async () => {
    setPasskeyMessage(null);
    setPasskeySubmitting(true);
    try {
      const { options, challengeToken } = await apiFetch<{
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
        challengeToken: string;
      }>("/api/auth/webauthn/register/options", { method: "POST" });

      const registrationResponse = await startRegistration({ optionsJSON: options });

      await apiFetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify({ response: registrationResponse, challengeToken }),
      });

      setPasskeyMessage({ type: "ok", text: "Passkeyを登録しました" });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // ユーザーがブラウザのPasskeyダイアログをキャンセルした場合は無言で戻す
        return;
      }
      const msg = err instanceof Error ? err.message : "Passkeyの登録に失敗しました";
      setPasskeyMessage({ type: "error", text: msg });
    } finally {
      setPasskeySubmitting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-slate-900 mb-6">アカウント設定</h1>

        <section>
          <h2 className="text-base font-bold text-slate-900 mb-4">{driver?.name}</h2>
        </section>

        {canUsePasskey && (
          <section className="mt-4">
            <h2 className="text-base font-bold text-slate-900 mb-4">Passkeyの登録</h2>
            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 max-w-sm">
              <p className="text-sm text-slate-600">
                指紋・顔認証などでログインできるようになります（パスワードでのログインも引き続き使えます）。
              </p>
              {passkeyMessage && (
                <p
                  className={`text-sm ${passkeyMessage.type === "ok" ? "text-green-600" : "text-red-600"
                    }`}
                >
                  {passkeyMessage.text}
                </p>
              )}
              <button
                type="button"
                onClick={handlePasskeyRegister}
                disabled={passkeySubmitting}
                className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {passkeySubmitting ? "登録中..." : "この端末にPasskeyを登録する"}
              </button>
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}
