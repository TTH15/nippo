"use client";

import { useState } from "react";
import { Nav } from "@/lib/components/Nav";
import { apiFetch } from "@/lib/api";

export default function SubmitPage() {
  const [form, setForm] = useState({
    takuhaibinCompleted: "",
    takuhaibinReturned: "",
    nekoposCompleted: "",
    nekoposReturned: "",
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const set = (key: keyof typeof form, value: string) => {
    // Only allow non-negative integers
    if (value !== "" && !/^\d+$/.test(value)) return;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      await apiFetch("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          takuhaibinCompleted: Number(form.takuhaibinCompleted) || 0,
          takuhaibinReturned: Number(form.takuhaibinReturned) || 0,
          nekoposCompleted: Number(form.nekoposCompleted) || 0,
          nekoposReturned: Number(form.nekoposReturned) || 0,
        }),
      });
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "送信に失敗しました");
    }
  };

  const fields: { key: keyof typeof form; label: string; sub: string }[] = [
    { key: "takuhaibinCompleted", label: "宅急便", sub: "完了" },
    { key: "takuhaibinReturned", label: "宅急便", sub: "持戻" },
    { key: "nekoposCompleted", label: "ネコポス", sub: "完了" },
    { key: "nekoposReturned", label: "ネコポス", sub: "持戻" },
  ];

  if (status === "success") {
    return (
      <>
        <Nav />
        <div className="max-w-sm mx-auto mt-20 text-center p-8">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">送信完了</h2>
          <p className="text-sm text-slate-500 mb-6">本日の日報を提出しました</p>
          <button
            onClick={() => { setStatus("idle"); setForm({ takuhaibinCompleted: "", takuhaibinReturned: "", nekoposCompleted: "", nekoposReturned: "" }); }}
            className="text-sm text-brand-600 font-medium hover:underline"
          >
            もう一度入力する（上書き）
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Nav />
      <div className="max-w-sm mx-auto px-4 py-8">
        <h1 className="text-lg font-bold text-brand-900 mb-6">本日の日報</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {f.label}
                  <span className={f.sub === "持戻" ? "text-orange-500 ml-1" : "text-blue-500 ml-1"}>
                    {f.sub}
                  </span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
            ))}
          </div>

          {status === "error" && (
            <p className="text-sm text-red-500 text-center">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full py-3.5 bg-brand-800 text-white font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {status === "loading" ? "送信中..." : "送信する"}
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center mt-4">
          同日の再送信は上書きされます
        </p>
      </div>
    </>
  );
}
