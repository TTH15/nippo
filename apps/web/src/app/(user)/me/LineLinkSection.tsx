"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { faLine } from "@fortawesome/free-brands-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";

// ============================================================
// LINE 連携（roadmap-2026-07 E②）。マイページのセクション。
// 手順: ここでコードを発行 → 本人が公式アカウントのトークにそのまま送信
//       → webhook が突合して identity と結合（LIFF は使わない）。
// LINE 未設定の環境（configured=false）ではセクションごと出さない。
// ============================================================

type LineStatus = {
  configured: boolean;
  linked: boolean;
  linkedAt: string | null;
  blocked: boolean;
};

export function LineLinkSection() {
  const { data, isInitialLoading, refresh } = useApi<LineStatus>("/api/me/line");
  const [code, setCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // 未設定環境・読み込み中は何も出さない（他セクションの邪魔をしない）
  if (isInitialLoading || !data?.configured) return null;

  const issueCode = async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ code: string }>("/api/me/line", { method: "POST" });
      setCode(res.code);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "連携コードの発行に失敗しました",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const unlink = async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      await apiFetch("/api/me/line", { method: "DELETE" });
      setCode(null);
      setMessage({ type: "ok", text: "連携を解除しました" });
      await refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "連携解除に失敗しました",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-10" id="line">
      <h2 className="text-base font-bold text-slate-900 mb-4">LINEでお知らせを受け取る</h2>
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 max-w-sm">
        {data.linked ? (
          <>
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4 text-green-600" />
              <span>連携済みです</span>
            </div>
            {data.blocked && (
              // ブロック中は連携が生きていても届かない。原因が分からず困るので明示する
              <p className="text-sm text-amber-600">
                公式アカウントがブロックされているため、現在LINEには届きません。ブロックを解除すると再開します。
              </p>
            )}
            <p className="text-sm text-slate-600">
              アプリの「お知らせ」に届く内容が、LINEにも同時に届きます。
            </p>
            <button
              type="button"
              onClick={unlink}
              disabled={submitting}
              className="w-full text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              連携を解除する
            </button>
          </>
        ) : code ? (
          <>
            <p className="text-sm text-slate-600">
              公式アカウントを友だち追加して、このコードをトークにそのまま送信してください。
            </p>
            <div className="text-center text-2xl tracking-[0.3em] font-mono py-3 px-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-900">
              {code}
            </div>
            <p className="text-xs text-slate-500">
              有効期限は10分です。切れた場合はもう一度発行してください。
            </p>
            <button
              type="button"
              onClick={refresh}
              className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors"
            >
              送信したので確認する
            </button>
            <button
              type="button"
              onClick={issueCode}
              disabled={submitting}
              className="w-full text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              コードを再発行する
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <FontAwesomeIcon icon={faLine} className="w-5 h-5 text-[#06C755]" />
              <span>まだ連携していません</span>
            </div>
            <p className="text-sm text-slate-600">
              連携すると、シフトの連絡や運営からのお知らせがLINEにも届きます。
            </p>
            <button
              type="button"
              onClick={issueCode}
              disabled={submitting}
              className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "発行中..." : "連携コードを発行する"}
            </button>
          </>
        )}
        {message && (
          <p className={`text-sm ${message.type === "ok" ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
