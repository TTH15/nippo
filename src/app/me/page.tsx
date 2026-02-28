"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/lib/components/Nav";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";

type Report = {
  id: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  submitted_at: string;
};

type Profile = {
  name: string;
  officeCode: string;
  driverCode: string;
  displayName: string;
  postalCode: string;
  address: string;
  phone: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
};

export default function MePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    apiFetch<Profile>("/api/reports/profile")
      .then(setProfile)
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, []);

  useEffect(() => {
    apiFetch<{ reports: Report[] }>("/api/reports/me")
      .then((d) => setReports(d.reports))
      .catch(() => {})
      .finally(() => setReportsLoading(false));
  }, []);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinMessage(null);
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      setPinMessage({ type: "error", text: "新しいPINは6桁の数字で入力してください" });
      return;
    }
    if (newPin !== confirmPin) {
      setPinMessage({ type: "error", text: "新しいPINと確認用が一致しません" });
      return;
    }
    setPinSubmitting(true);
    try {
      await apiFetch("/api/reports/profile", {
        method: "PATCH",
        body: JSON.stringify({ newPin, confirmPin }),
      });
      setPinMessage({ type: "ok", text: "PINを変更しました" });
      setNewPin("");
      setConfirmPin("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "PINの変更に失敗しました";
      setPinMessage({ type: "error", text: msg });
    } finally {
      setPinSubmitting(false);
    }
  };

  const profileEntries: { label: string; value: string }[] = profile
    ? [
        { label: "名前", value: profile.name },
        { label: "表示名", value: profile.displayName },
        { label: "ドライバーコード", value: profile.driverCode },
        { label: "営業所コード", value: profile.officeCode },
        { label: "郵便番号", value: profile.postalCode },
        { label: "住所", value: profile.address },
        { label: "電話番号", value: profile.phone },
        { label: "銀行名", value: profile.bankName },
        { label: "口座番号", value: profile.bankNo },
        { label: "口座名義", value: profile.bankHolder },
      ].filter((e) => e.value !== undefined && e.value !== "")
    : [];

  return (
    <>
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        {/* プロフィール */}
        <section>
          <h1 className="text-lg font-bold text-slate-900 mb-4">プロフィール</h1>
          {profileLoading ? (
            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-5 w-full max-w-xs" />
              ))}
            </div>
          ) : profileEntries.length === 0 ? (
            <p className="text-sm text-slate-500">登録内容はありません</p>
          ) : (
            <dl className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
              {profileEntries.map(({ label, value }) => (
                <div key={label} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1">
                  <dt className="text-sm font-medium text-slate-500 min-w-[120px]">{label}</dt>
                  <dd className="text-sm text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* PIN変更 */}
        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-4">PINの変更</h2>
          <form onSubmit={handlePinSubmit} className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 max-w-sm">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">新しいPIN（6桁）</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full text-center text-lg tracking-wider font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                placeholder="000000"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">確認用（6桁）</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full text-center text-lg tracking-wider font-mono py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                placeholder="000000"
                autoComplete="new-password"
              />
            </div>
            {pinMessage && (
              <p className={`text-sm ${pinMessage.type === "ok" ? "text-green-600" : "text-red-600"}`}>
                {pinMessage.text}
              </p>
            )}
            <button
              type="submit"
              disabled={pinSubmitting || newPin.length !== 6 || confirmPin.length !== 6}
              className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pinSubmitting ? "変更中..." : "PINを変更する"}
            </button>
          </form>
        </section>

        {/* 提出履歴 */}
        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-4">提出履歴</h2>
          {reportsLoading ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 pr-3"><Skeleton className="h-4 w-12" /></th>
                    <th className="py-3 px-2"><Skeleton className="h-4 w-12 ml-auto" /></th>
                    <th className="py-3 px-2"><Skeleton className="h-4 w-12 ml-auto" /></th>
                    <th className="py-3 px-2"><Skeleton className="h-4 w-12 ml-auto" /></th>
                    <th className="py-3 pl-2"><Skeleton className="h-4 w-12 ml-auto" /></th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-3"><Skeleton className="h-4 w-20" /></td>
                      <td className="py-3 px-2 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-2 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 px-2 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="py-3 pl-2 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : reports.length === 0 ? (
            <p className="text-sm text-slate-500">まだ提出がありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 pr-3 font-semibold text-slate-600">日付</th>
                    <th className="py-3 px-2 font-semibold text-slate-600 text-right">宅急便<br/><span className="text-xs font-normal">完了</span></th>
                    <th className="py-3 px-2 font-semibold text-slate-600 text-right">宅急便<br/><span className="text-xs font-normal">持戻</span></th>
                    <th className="py-3 px-2 font-semibold text-slate-600 text-right">ネコポス<br/><span className="text-xs font-normal">完了</span></th>
                    <th className="py-3 pl-2 font-semibold text-slate-600 text-right">ネコポス<br/><span className="text-xs font-normal">持戻</span></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 pr-3 font-medium">{r.report_date}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{r.takuhaibin_completed}</td>
                      <td className="py-3 px-2 text-right tabular-nums text-orange-600">{r.takuhaibin_returned}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{r.nekopos_completed}</td>
                      <td className="py-3 pl-2 text-right tabular-nums text-orange-600">{r.nekopos_returned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
