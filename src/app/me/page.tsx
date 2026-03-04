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

type MeShift = {
  shift_date: string;
  course_name: string;
  course_color: string | null;
  slot: number;
};

type RewardLogDetail = {
  log_date: string;
  type_name: string;
  content: string;
  amount: number;
};

type FixedExpenseDetail = {
  id: string;
  name: string;
  amount: number;
};

type RewardsSummary = {
  month: string;
  startDate: string;
  endDate: string;
  incomeLog: number;
  variableDeductions: number;
  fixedDeductions: number;
  net: number;
  logDetails: RewardLogDetail[];
  fixedDetails: FixedExpenseDetail[];
};

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function formatDateWithWeekday(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export default function MePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [shiftMonth, setShiftMonth] = useState(() => currentYearMonth());
  const [shifts, setShifts] = useState<MeShift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(true);
  const [shiftsError, setShiftsError] = useState<string | null>(null);
  const [rewardMonth, setRewardMonth] = useState(() => currentYearMonth());
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [rewardsError, setRewardsError] = useState<string | null>(null);

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

  useEffect(() => {
    const { year, month } = shiftMonth;
    setShiftsLoading(true);
    setShiftsError(null);
    const { start, end } = getMonthDateRange(year, month);
    apiFetch<{ shifts: MeShift[] }>(`/api/me/shifts?start=${start}&end=${end}`)
      .then((d) => {
        setShifts(d.shifts ?? []);
      })
      .catch((e: unknown) => {
        console.error(e);
        setShiftsError("シフトの取得に失敗しました");
      })
      .finally(() => setShiftsLoading(false));
  }, [shiftMonth]);

  useEffect(() => {
    const { year, month } = rewardMonth;
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    setRewardsLoading(true);
    setRewardsError(null);
    apiFetch<RewardsSummary>(`/api/me/rewards?month=${monthStr}`)
      .then((d) => {
        setRewards(d);
      })
      .catch((e: unknown) => {
        console.error(e);
        setRewardsError("報酬サマリの取得に失敗しました");
      })
      .finally(() => setRewardsLoading(false));
  }, [rewardMonth]);

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

        {/* シフト */}
        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-4">シフト</h2>
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() =>
                setShiftMonth((m) => {
                  if (m.month === 1) return { year: m.year - 1, month: 12 };
                  return { ...m, month: m.month - 1 };
                })
              }
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              ← 前月
            </button>
            <div className="text-sm font-medium text-slate-900">
              {shiftMonth.year}年 {shiftMonth.month}月
            </div>
            <button
              type="button"
              onClick={() =>
                setShiftMonth((m) => {
                  if (m.month === 12) return { year: m.year + 1, month: 1 };
                  return { ...m, month: m.month + 1 };
                })
              }
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              翌月 →
            </button>
          </div>
          {shiftsLoading ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 pr-3">
                      <Skeleton className="h-4 w-20" />
                    </th>
                    <th className="py-3 px-2">
                      <Skeleton className="h-4 w-24" />
                    </th>
                    <th className="py-3 px-2">
                      <Skeleton className="h-4 w-16" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="py-3 px-2">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="py-3 px-2 text-right">
                        <Skeleton className="h-4 w-8 ml-auto" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : shiftsError ? (
            <p className="text-sm text-red-600">{shiftsError}</p>
          ) : shifts.length === 0 ? (
            <p className="text-sm text-slate-500">この月のシフトは登録されていません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-3 pr-3 font-semibold text-slate-600">日付</th>
                    <th className="py-3 px-2 font-semibold text-slate-600">コース</th>
                    <th className="py-3 px-2 font-semibold text-slate-600 text-right">スロット</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s, idx) => (
                    <tr key={`${s.shift_date}-${s.course_name}-${s.slot}-${idx}`} className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateWithWeekday(s.shift_date)}</td>
                      <td className="py-2.5 px-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          style={s.course_color ? { backgroundColor: s.course_color, color: "#ffffff" } : {}}
                        >
                          {s.course_name || "-"}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{s.slot}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 報酬 */}
        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-4">報酬</h2>
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() =>
                setRewardMonth((m) => {
                  if (m.month === 1) return { year: m.year - 1, month: 12 };
                  return { ...m, month: m.month - 1 };
                })
              }
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              ← 前月
            </button>
            <div className="text-sm font-medium text-slate-900">
              {rewardMonth.year}年 {rewardMonth.month}月
            </div>
            <button
              type="button"
              onClick={() =>
                setRewardMonth((m) => {
                  if (m.month === 12) return { year: m.year + 1, month: 1 };
                  return { ...m, month: m.month + 1 };
                })
              }
              className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              翌月 →
            </button>
          </div>

          {rewardsLoading ? (
            <div className="space-y-4">
              <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-40" />
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 p-3">
                <Skeleton className="h-4 w-24 mb-2" />
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : rewardsError ? (
            <p className="text-sm text-red-600">{rewardsError}</p>
          ) : !rewards ? (
            <p className="text-sm text-slate-500">報酬情報を取得できませんでした</p>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="text-xs font-medium text-slate-500">
                  今月の暫定報酬（{rewards.startDate}〜{rewards.endDate}）
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {formatYen(rewards.net)}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-slate-500">収入</div>
                    <div className="mt-0.5 font-mono text-slate-900">
                      {formatYen(rewards.incomeLog)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">変動控除</div>
                    <div className="mt-0.5 font-mono text-orange-600">
                      {formatYen(rewards.variableDeductions)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">固定控除</div>
                    <div className="mt-0.5 font-mono text-orange-600">
                      {formatYen(-rewards.fixedDeductions)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 mb-2">
                    ログ明細
                  </h3>
                  {rewards.logDetails.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      この月のログ明細はありません
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="py-1.5 px-2 text-left font-medium text-slate-600">
                              日付
                            </th>
                            <th className="py-1.5 px-2 text-left font-medium text-slate-600">
                              種別
                            </th>
                            <th className="py-1.5 px-2 text-left font-medium text-slate-600">
                              内容
                            </th>
                            <th className="py-1.5 px-2 text-right font-medium text-slate-600">
                              金額
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rewards.logDetails.map((l, idx) => (
                            <tr
                              key={`${l.log_date}-${idx}`}
                              className="border-b border-slate-100 last:border-b-0"
                            >
                              <td className="py-1.5 px-2 whitespace-nowrap">
                                {l.log_date}
                              </td>
                              <td className="py-1.5 px-2 whitespace-nowrap text-slate-700">
                                {l.type_name}
                              </td>
                              <td className="py-1.5 px-2 text-slate-700">
                                {l.content}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums">
                                <span
                                  className={
                                    l.amount >= 0
                                      ? "text-slate-900"
                                      : "text-orange-600"
                                  }
                                >
                                  {formatYen(l.amount)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-800 mb-2">
                    固定経費
                  </h3>
                  {rewards.fixedDetails.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      この月に有効な固定経費はありません
                    </p>
                  ) : (
                    <ul className="space-y-1 text-xs text-slate-700">
                      {rewards.fixedDetails.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between"
                        >
                          <span>{f.name}</span>
                          <span className="font-mono text-orange-600">
                            {formatYen(-f.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
