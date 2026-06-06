"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/lib/components/Skeleton";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { apiFetch } from "@/lib/api";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { TeamPointsCard } from "@/lib/components/TeamPointsCard";

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

type Vehicle = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

type ReportKindOption = {
  key: string;
  label: string;
  usesLocation: boolean;
  usesOdometer: boolean;
  usesDescription: boolean;
  usesAmount: boolean;
  descriptionRequired: boolean;
  descriptionLabel: string | null;
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
  const [reportKinds, setReportKinds] = useState<ReportKindOption[]>([]);
  const [reportKind, setReportKind] = useState<string>("");
  const [reportDescription, setReportDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportMessage, setReportMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [unlinkedVehicles, setUnlinkedVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [confirmVehicle, setConfirmVehicle] = useState<Vehicle | null>(null);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  useBodyScrollLock(showVehicleModal);

  useEffect(() => {
    apiFetch<Profile>("/api/reports/profile")
      .then(setProfile)
      .catch(() => { })
      .finally(() => setProfileLoading(false));
  }, []);

  // 報告種別（設定マスタ）を取得。先頭を既定選択に。
  useEffect(() => {
    if (!isReport) return;
    apiFetch<{ kinds: ReportKindOption[] }>("/api/me/report-kinds")
      .then((res) => {
        const kinds = res.kinds ?? [];
        setReportKinds(kinds);
        setReportKind((prev) => prev || kinds[0]?.key || "");
      })
      .catch(() => { });
  }, [isReport]);

  const currentKind = reportKinds.find((k) => k.key === reportKind) ?? null;

  useEffect(() => {
    if (!isReport) return;
    const loadVehicles = async () => {
      setVehiclesLoading(true);
      try {
        const [vehiclesRes, prefRes, unlinkedRes] = await Promise.all([
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles", { cache: "no-store" }),
          apiFetch<{ vehicleId: string | null }>("/api/reports/vehicle-preference"),
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles-unlinked", { cache: "no-store" }).catch(
            () => ({ vehicles: [] as Vehicle[] }),
          ),
        ]);
        const linkedVehicles = vehiclesRes.vehicles ?? [];
        const otherVehicles = unlinkedRes.vehicles ?? [];
        setVehicles(linkedVehicles);
        setUnlinkedVehicles(otherVehicles);

        const preferredId = prefRes.vehicleId;
        const preferredInLinked = preferredId ? linkedVehicles.some((v) => v.id === preferredId) : false;
        if (preferredInLinked && preferredId) {
          setSelectedVehicleId(preferredId);
        } else if (linkedVehicles.length > 0) {
          setSelectedVehicleId(linkedVehicles[0].id);
        } else {
          setSelectedVehicleId(null);
        }
      } catch {
        setVehicles([]);
        setUnlinkedVehicles([]);
        setSelectedVehicleId(null);
      } finally {
        setVehiclesLoading(false);
      }
    };
    loadVehicles();
  }, [isReport]);

  const allKnownVehicles = useMemo(
    () => Array.from(new Map([...vehicles, ...unlinkedVehicles].map((v) => [v.id, v] as const)).values()),
    [vehicles, unlinkedVehicles],
  );

  const vehicleCandidates = useMemo(
    () => allKnownVehicles.filter((v) => (selectedVehicleId ? v.id !== selectedVehicleId : true)),
    [allKnownVehicles, selectedVehicleId],
  );

  const saveVehiclePreference = async (vehicleId: string) => {
    try {
      await apiFetch("/api/reports/vehicle-preference", {
        method: "PUT",
        body: JSON.stringify({ vehicleId }),
      });
    } catch {
      // noop
    }
  };

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

  const handleMiscReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportMessage(null);
    const location = reportLocation.trim();
    const kilometer = Number(odometerKm);
    const desc = reportDescription.trim();
    const expenseYen = Number(expenseAmount);
    const kind = currentKind;
    if (!kind) {
      setReportMessage({ type: "error", text: "報告の種類を選択してください" });
      return;
    }
    if (kind.usesLocation && !location) {
      setReportMessage({ type: "error", text: "場所を入力してください" });
      return;
    }
    if (kind.usesOdometer && (!Number.isInteger(kilometer) || kilometer < 0)) {
      setReportMessage({ type: "error", text: "交換時走行距離は0以上の整数で入力してください" });
      return;
    }
    if (kind.usesDescription && kind.descriptionRequired && desc.length < 1) {
      setReportMessage({ type: "error", text: `${kind.descriptionLabel || "内容"}を入力してください` });
      return;
    }
    if (kind.usesAmount && (!Number.isInteger(expenseYen) || expenseYen <= 0)) {
      setReportMessage({ type: "error", text: "経費金額は1円以上の整数で入力してください" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !/^\d{2}:\d{2}$/.test(reportTime)) {
      setReportMessage({ type: "error", text: "日付・時間の形式が不正です" });
      return;
    }
    if (!selectedVehicleId) {
      setReportMessage({ type: "error", text: "車両を選択してください" });
      return;
    }
    setReportSubmitting(true);
    try {
      await apiFetch("/api/reports/oil-change", {
        method: "POST",
        body: JSON.stringify({
          reportDate,
          reportTime,
          location: kind.usesLocation ? location : "",
          reportKind,
          description: kind.usesDescription ? desc : "",
          odometerKm: kind.usesOdometer ? kilometer : null,
          expenseAmount: kind.usesAmount ? expenseYen : null,
          vehicleId: selectedVehicleId,
        }),
      });
      await saveVehiclePreference(selectedVehicleId);
      setReportMessage({ type: "ok", text: "報告を送信しました" });
      setReportLocation("");
      setOdometerKm("");
      setReportDescription("");
      setExpenseAmount("");
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
        <h1 className="text-lg font-bold text-slate-900 mb-6">諸報告</h1>
        <section>
          <h2 className="text-base font-bold text-slate-900 mb-1">オイル交換・修理・経費報告など</h2>
          <p className="text-sm text-slate-500 mb-1">種別を選び、内容を入力して送信してください。</p>
          <p className="text-xs text-slate-500 mb-4">
            経費報告は会社へ請求する内容です。運営承認後、ペイメントに算入され、ドライバー報酬へ加算されます。
          </p>
          <form
            onSubmit={handleMiscReportSubmit}
            className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 max-w-lg"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">報告の種類</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {reportKinds.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setReportKind(opt.key)}
                    className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      reportKind === opt.key
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {vehiclesLoading ? (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">実施車両</label>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-40 flex-shrink-0 rounded-lg" />
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">実施車両</label>
                {vehicles.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex gap-2 overflow-x-auto">
                      {vehicles.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setSelectedVehicleId(v.id);
                            saveVehiclePreference(v.id);
                          }}
                          className={`flex-shrink-0 w-52 rounded-lg border px-1 pt-1 pb-2 ${
                            selectedVehicleId === v.id
                              ? "border-slate-900"
                              : "border-slate-200 hover:border-slate-400"
                          }`}
                        >
                          <div className="w-[200px] mx-auto">
                            <VehiclePlate
                              vehicle={v}
                              selected={selectedVehicleId === v.id}
                              glow={false}
                              className="w-full max-w-[200px]"
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                    {vehicleCandidates.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowVehicleModal(true);
                          setConfirmVehicle(null);
                        }}
                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                      >
                        他の車両を選択
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    選択可能な車両がありません。管理者に連絡してください。
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="block text-sm font-medium text-slate-700 mb-1">日付</label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="block w-full min-w-0 py-2.5 px-3 border border-slate-200 rounded-lg text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-sm font-medium text-slate-700 mb-1">時間</label>
                <input
                  type="time"
                  value={reportTime}
                  onChange={(e) => setReportTime(e.target.value)}
                  className="block w-full min-w-0 py-2.5 px-3 border border-slate-200 rounded-lg text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>
            </div>
            {currentKind?.usesLocation && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">場所</label>
                <input
                  type="text"
                  value={reportLocation}
                  onChange={(e) => setReportLocation(e.target.value)}
                  className="w-full py-2.5 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                  placeholder={
                    currentKind?.usesOdometer
                      ? "例: ○○サービスエリア"
                      : "例: 整備工場名・現場住所など"
                  }
                />
              </div>
            )}
            {currentKind?.usesOdometer && (
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
            )}
            {currentKind?.usesDescription && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{currentKind?.descriptionLabel || "内容"}</label>
                <textarea
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  rows={4}
                  className="w-full py-2.5 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none text-sm resize-y min-h-[96px]"
                  placeholder="実施内容・依頼内容・金額の目安など、管理者が判断できるよう具体的に記入してください"
                />
              </div>
            )}
            {currentKind?.usesAmount && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">経費金額 (円)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="w-full py-2.5 px-3 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none"
                  placeholder="例: 3500"
                />
              </div>
            )}
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
          {showVehicleModal && (
            <div
              className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
              onClick={() => {
                setShowVehicleModal(false);
                setConfirmVehicle(null);
              }}
            >
              <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-sm font-semibold text-slate-900 mb-2">他の車両を選択</h2>
                <p className="text-xs text-slate-500 mb-4">報告に紐づける車両を選択してください。</p>
                {vehicleCandidates.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">選択できる車両がありません。</p>
                ) : (
                  <>
                    <div className="flex items-center overflow-x-auto pb-2 gap-2">
                      {vehicleCandidates.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setConfirmVehicle(v)}
                          className={`flex-shrink-0 w-52 rounded-lg border px-1 pt-1 pb-2 ${
                            confirmVehicle?.id === v.id
                              ? "border-slate-900"
                              : "border-slate-200 hover:border-slate-400"
                          }`}
                        >
                          <div className="w-[200px] mx-auto">
                            <VehiclePlate vehicle={v} glow={false} className="w-full max-w-[200px]" />
                          </div>
                        </button>
                      ))}
                    </div>
                    {confirmVehicle && (
                      <div className="mt-2 border-t border-slate-200 pt-3">
                        <p className="text-xs text-slate-700 mb-2">この車両で正しいですか？</p>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmVehicle(null)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800"
                          >
                            戻る
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!confirmVehicle) return;
                              setVehicles((prev) => (prev.some((x) => x.id === confirmVehicle.id) ? prev : [...prev, confirmVehicle]));
                              setSelectedVehicleId(confirmVehicle.id);
                              saveVehiclePreference(confirmVehicle.id);
                              setShowVehicleModal(false);
                              setConfirmVehicle(null);
                            }}
                            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-700"
                          >
                            この車両を使う
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowVehicleModal(false);
                      setConfirmVehicle(null);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          )}
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

      <div className="mb-6">
        <TeamPointsCard />
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
