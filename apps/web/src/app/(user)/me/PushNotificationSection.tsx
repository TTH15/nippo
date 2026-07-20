"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faBell, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import {
  detectPushEnvironment,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  type PushEnvironment,
} from "@/lib/webPush";

// ============================================================
// 端末への通知（Web Push）。roadmap-2026-07 E⑦。
// LINE 未連携でも気づけるようにするための経路。
//
// 環境で出し分ける:
//   supported          → 許可ボタン（Android Chrome・デスクトップ・追加済み iOS）
//   ios_needs_install  → ホーム画面追加の案内（iOS の制約は回避できない）
//   unsupported        → 何も出さない（LINE 連携とインボックスで受け取ってもらう）
// ============================================================

export function PushNotificationSection() {
  const { data } = useApi<{ configured: boolean; publicKey: string | null }>("/api/me/push");
  const [env, setEnv] = useState<PushEnvironment | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // 環境判定と購読状態は client でしか分からないため mount 後に解決する
  useEffect(() => {
    setEnv(detectPushEnvironment());
    getExistingSubscription()
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => setSubscribed(false));
  }, []);

  // サーバー未設定・判定前・非対応環境では出さない
  if (!data?.configured || env === null || env === "unsupported") return null;

  const enable = async () => {
    if (!data.publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await subscribeToPush(data.publicKey);
      if (!outcome.ok) {
        setMessage({
          type: "error",
          text:
            outcome.reason === "denied"
              ? "通知がブロックされています。ブラウザの設定から許可してください。"
              : "通知を有効にできませんでした。",
        });
        return;
      }
      await apiFetch("/api/me/push", {
        method: "POST",
        body: JSON.stringify(outcome.subscription),
      });
      setSubscribed(true);
      setMessage({ type: "ok", text: "この端末で通知を受け取れるようになりました" });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "通知の登録に失敗しました",
      });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) {
        await apiFetch("/api/me/push", {
          method: "DELETE",
          body: JSON.stringify({ endpoint }),
        });
      }
      setSubscribed(false);
      setMessage({ type: "ok", text: "この端末の通知を停止しました" });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "通知の停止に失敗しました",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10" id="push">
      <h2 className="text-base font-bold text-slate-900 mb-4">この端末で通知を受け取る</h2>
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 max-w-sm">
        {env === "ios_needs_install" ? (
          <>
            <div className="flex items-start gap-2 text-sm text-slate-600">
              <FontAwesomeIcon icon={faCircleInfo} className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
              <span>
                iPhone・iPad では、この画面をホーム画面に追加すると通知を受け取れるようになります。
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Safari の共有ボタン → 「ホーム画面に追加」→ 追加したアイコンから開き直してください。
            </p>
            <p className="text-sm text-slate-500">
              追加せずに使う場合は、上のLINE連携をしておくと通知が届きます。
            </p>
          </>
        ) : subscribed ? (
          <>
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4 text-green-600" />
              <span>この端末で通知を受け取ります</span>
            </div>
            <p className="text-sm text-slate-600">
              端末ごとの設定です。別の端末でも受け取るには、その端末で同じ操作をしてください。
            </p>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="w-full text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              この端末の通知を停止する
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <FontAwesomeIcon icon={faBell} className="w-4 h-4 text-slate-400" />
              <span>通知はオフです</span>
            </div>
            <p className="text-sm text-slate-600">
              オンにすると、お知らせが届いたときにこの端末に通知が表示されます。
            </p>
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "設定中..." : "通知をオンにする"}
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
