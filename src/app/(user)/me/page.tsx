"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";

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

function MePageContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  const isReport = tabParam === "report";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const now = useMemo(() => new Date(), []);
  const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const defaultTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const [reportDate, setReportDate] = useState(defaultDate);
  const [reportTime, setReportTime] = useState(defaultTime);
  const [reportLocation, setReportLocation] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportMessage, setReportMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    apiFetch<Profile>("/api/reports/profile")
      .then(setProfile)
      .catch(() => { })
      .finally(() => setProfileLoading(false));
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

  const handleOilReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportMessage(null);
    const location = reportLocation.trim();
    const kilometer = Number(odometerKm);
    if (!location) {
      setReportMessage({ type: "error", text: "場所を入力してください" });
      return;
    }
    if (!Number.isInteger(kilometer) || kilometer < 0) {
      setReportMessage({ type: "error", text: "交換時走行距離は0以上の整数で入力してください" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !/^\d{2}:\d{2}$/.test(reportTime)) {
      setReportMessage({ type: "error", text: "日付・時間の形式が不正です" });
      return;
    }
    setReportSubmitting(true);
    try {
      await apiFetch("/api/reports/oil-change", {
        method: "POST",
        body: JSON.stringify({
          reportDate,
          reportTime,
          location,
          odometerKm: kilometer,
        }),
      });
      setReportMessage({ type: "ok", text: "オイル交換報告を送信しました" });
      setReportLocation("");
      setOdometerKm("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "報告の送信に失敗しました";
      setReportMessage({ type: "error", text: msg });
    } finally {
      setReportSubmitting(false);
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

  if (isReport) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-slate-900 mb-6">報告</h1>
        <section>
          <h2 className="text-base font-bold text-slate-900 mb-4">オイル交換の実施報告</h2>
          <form
            onSubmit={handleOilReportSubmit}
            className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 max-w-lg"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">日付</label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="w-full py-2.5 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">時間</label>
                <input
                  type="time"
                  value={reportTime}
                  onChange={(e) => setReportTime(e.target.value)}
                  className="w-full py-2.5 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">場所</label>
              <input
                type="text"
                value={reportLocation}
                onChange={(e) => setReportLocation(e.target.value)}
                className="w-full py-2.5 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                placeholder="例: ○○サービスエリア"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">交換時走行距離 (km)</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={odometerKm}
                onChange={(e) => setOdometerKm(e.target.value)}
                className="w-full py-2.5 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                placeholder="例: 123456"
              />
            </div>
            {reportMessage && (
              <p className={`text-sm ${reportMessage.type === "ok" ? "text-green-600" : "text-red-600"}`}>
                {reportMessage.text}
              </p>
            )}
            <button
              type="submit"
              disabled={reportSubmitting}
              className="w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {reportSubmitting ? "送信中..." : "報告を送信する"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  // マイページ: プロフィール + PIN変更
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-900">マイページ</h1>
      </div>

      <section className="mb-10">
        <h2 className="text-base font-bold text-slate-900 mb-3">プロフィール</h2>
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
              <div
                key={label}
                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1"
              >
                <dt className="text-sm font-medium text-slate-500 min-w-[120px]">{label}</dt>
                <dd className="text-sm text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section>
        <h2 className="text-base font-bold text-slate-900 mb-4">PINの変更</h2>
        <form
          onSubmit={handlePinSubmit}
          className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 max-w-sm"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              新しいPIN（6桁）
            </label>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">
              確認用（6桁）
            </label>
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
            <p
              className={`text-sm ${pinMessage.type === "ok" ? "text-green-600" : "text-red-600"
                }`}
            >
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
    </div>
  );
}

function MePageFallback() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="h-8 w-48 mb-4">
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="mt-6 space-y-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense fallback={<MePageFallback />}>
      <MePageContent />
    </Suspense>
  );
}
