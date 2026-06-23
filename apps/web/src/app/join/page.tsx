"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

// ============================================================
// 公開・参加申請ページ（Phase 7b）。認証不要。
// 参加コード（join_code）＋氏名＋電話で参加を申請する。承認されるまでログイン不可。
// driver_code/PIN は運営が承認時に発行する。
// ============================================================

export default function JoinPage() {
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [doneOrg, setDoneOrg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ ok: boolean; organizationName?: string }>("/api/join", {
        method: "POST",
        body: JSON.stringify({ joinCode: joinCode.trim().toUpperCase(), name: name.trim(), phone: phone.trim() }),
      });
      setDoneOrg(res.organizationName ?? "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "申請に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const isValid = joinCode.trim().length >= 4 && name.trim().length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="p-3 border-b border-slate-200">
            <div className="flex flex-col items-center">
              <img
                src="/logo/Nippo.svg"
                alt="ロゴ"
                className="h-12 mb-2"
                style={{ maxWidth: "60%", height: "auto" }}
              />
            </div>
          </div>

          {doneOrg !== null ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-base font-semibold text-slate-900">申請を受け付けました</p>
              <p className="text-sm text-slate-600">
                {doneOrg ? `「${doneOrg}」` : "会社"}の運営による承認をお待ちください。
                <br />
                承認されると、運営からドライバーコードと初期PINが連絡されます。
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <p className="text-sm text-slate-600">
                運営から受け取った参加コードと、あなたの情報を入力してください。
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">参加コード</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
                  className="w-full text-center text-lg tracking-widest font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="ABC123"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">氏名</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="山田 太郎"
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  電話番号<span className="text-slate-400 font-normal">（任意）</span>
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="090-1234-5678"
                  autoComplete="tel"
                />
              </div>

              {error && <p className="text-sm text-red-600 text-center">{error}</p>}

              <button
                type="submit"
                disabled={loading || !isValid}
                className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "送信中..." : "参加を申請する"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
