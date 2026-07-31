"use client";

import { useState } from "react";

// 公開: 運営社オンボーディング申請フォーム（§2-5）。
// 即発行はしない — 申請後に導入相談（料金・ログイン方式・初期設定）を経て承認・発行される。

export default function ApplyPage() {
  const [form, setForm] = useState({
    companyName: "",
    corporateNumber: "",
    representative: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    message: "",
    website: "", // ハニーポット（非表示）
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "送信に失敗しました");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md text-center space-y-3">
          <h1 className="text-xl font-bold text-slate-900">申請を受け付けました</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            内容を確認のうえ、担当者よりご連絡します。導入のご相談（料金・初期設定）を経て、アカウントを発行します。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="mx-auto max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900">ハコ虎 導入申請</h1>
          <p className="text-sm text-slate-500 mt-2">
            配送業務の記録・シフト・報酬を1つにまとめる業務プラットフォーム。
            <br />
            申請後、担当者から導入のご案内をお送りします。
          </p>
        </div>

        <form className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4" onSubmit={submit}>
          <Field label="会社名" required>
            <input className={INPUT} value={form.companyName} onChange={set("companyName")} required maxLength={200} />
          </Field>
          <Field label="法人番号（13桁・任意)">
            <input className={INPUT} value={form.corporateNumber} onChange={set("corporateNumber")} inputMode="numeric" maxLength={13} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="代表者名">
              <input className={INPUT} value={form.representative} onChange={set("representative")} maxLength={100} />
            </Field>
            <Field label="ご担当者名">
              <input className={INPUT} value={form.contactName} onChange={set("contactName")} maxLength={100} />
            </Field>
          </div>
          <Field label="連絡先メールアドレス" required>
            <input className={INPUT} type="email" value={form.contactEmail} onChange={set("contactEmail")} required maxLength={200} />
          </Field>
          <Field label="電話番号">
            <input className={INPUT} type="tel" value={form.contactPhone} onChange={set("contactPhone")} maxLength={20} />
          </Field>
          <Field label="所在地">
            <input className={INPUT} value={form.address} onChange={set("address")} maxLength={300} />
          </Field>
          <Field label="ご相談内容・メッセージ">
            <textarea className={`${INPUT} min-h-[96px]`} value={form.message} onChange={set("message")} maxLength={500} />
          </Field>

          {/* ハニーポット: 画面に出さない。bot 対策 */}
          <input
            className="hidden"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={set("website")}
            aria-hidden
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-50"
            disabled={submitting || !form.companyName.trim() || !form.contactEmail.trim()}
          >
            {submitting ? "送信中..." : "申請する"}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            ご入力いただいた情報は導入のご連絡のみに使用します。
          </p>
        </form>
      </div>
    </div>
  );
}

const INPUT = "mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
