"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/lib/components/Skeleton";
import { CountUp } from "@/lib/components/CountUp";
import { DatePicker } from "@/lib/components/DatePicker";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { apiFetch } from "@/lib/api";
import { reportDateDefaultJST, reportDateStrToDate, dateToReportDateStr } from "@/lib/date";

// ============================================================
// 動的日報フォーム（新モデル）。
//   その日のシフト(=コース)ごとに、キャリア配下の unit と報告項目を動的描画。
//   複数シフト（昼ヤマト＋夜Amazon等）は複数カードで表示し、まとめて送信。
//   送信は POST /api/reports/v2（daily_reports_v2 + report_entries）。
// 注: 旧 SubmitPageClient とは別ファイル。ルートは page.tsx で切替。
// ============================================================

type PersonalRanking = {
  mode: "personal";
  metricLabel: string;
  ranking: { rank: number; name: string; value: number; isMe: boolean }[];
  myRank: { rank: number; name: string; value: number; isMe: boolean } | null;
  total: number;
  configured: boolean;
};
type TeamRanking = {
  mode: "team";
  eventName: string;
  myTeamId: string | null;
  myTeam?: { id: string; name: string; color: string; total: number } | null;
  rankingVisible?: boolean;
  teams: { rank: number; teamId: string; name: string; color: string; total: number }[];
  individuals: { rank: number; name: string; total: number; isMe: boolean }[];
};
type SubmitScreen = {
  date: string;
  todayReward: number;
  todayPoints?: number;
  ranking: PersonalRanking | TeamRanking | null;
};

type DriverIdentity = { id: string; slot: number; driverCode: string; officeCode: string; label?: string };
type Vehicle = {
  id: string;
  manufacturer?: string | null;
  brand?: string | null;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  current_mileage?: number;
  is_ev?: boolean;
};

type FieldDef = {
  fieldKey: string;
  label: string;
  inputType: "INT" | "TEXT" | "TIME" | "BOOL";
  groupLabel: string | null;
  required: boolean;
};
type UnitDef = { id: string; name: string; code: string | null; billingType: "PER_PIECE" | "FIXED"; fields: FieldDef[] };
type ShiftForm = {
  courseId: string;
  courseName: string;
  color: string | null;
  carrierId: string | null;
  carrierName: string;
  units: UnitDef[];
  existing: { vehicleId: string | null; meterValue: number | null; values: Record<string, Record<string, number | string>> } | null;
};

// values[courseId][unitId][fieldKey] = string
type ValueMap = Record<string, Record<string, Record<string, string>>>;

export default function SubmitPageClientV2() {
  const [reportDate, setReportDate] = useState<Date>(() => reportDateStrToDate(reportDateDefaultJST()));
  const [identities, setIdentities] = useState<DriverIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [unlinkedVehicles, setUnlinkedVehicles] = useState<Vehicle[]>([]);
  const [showOtherVehicles, setShowOtherVehicles] = useState(false);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [meter, setMeter] = useState<string>("");

  const [postSubmit, setPostSubmit] = useState<SubmitScreen | null>(null);

  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [values, setValues] = useState<ValueMap>({});
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // プロフィール（勤務区分）・車両（紐付け＋その他）
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [profile, vehiclesRes, unlinkedRes] = await Promise.all([
          apiFetch<{ identities?: DriverIdentity[] }>("/api/reports/profile").catch(() => null),
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles", { cache: "no-store" }).catch(() => ({ vehicles: [] })),
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles-unlinked", { cache: "no-store" }).catch(() => ({ vehicles: [] })),
        ]);
        const list = profile?.identities ?? [];
        setIdentities(list);
        if (list.length > 0) setSelectedIdentityId(list[0].id);
        setVehicles(vehiclesRes.vehicles ?? []);
        setUnlinkedVehicles(unlinkedRes.vehicles ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 日付ごとの動的フォーム
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFormLoading(true);
      try {
        const dateStr = dateToReportDateStr(reportDate);
        const res = await apiFetch<{ shifts: ShiftForm[]; shiftVehicleId?: string | null }>(`/api/me/report-form?date=${encodeURIComponent(dateStr)}`, { cache: "no-store" });
        if (cancelled) return;
        const list = res.shifts ?? [];
        setShifts(list);
        // 既存値で初期化
        const init: ValueMap = {};
        list.forEach((s) => {
          init[s.courseId] = {};
          s.units.forEach((u) => {
            init[s.courseId][u.id] = {};
            u.fields.forEach((f) => {
              const existing = s.existing?.values?.[u.id]?.[f.fieldKey];
              init[s.courseId][u.id][f.fieldKey] = existing != null ? String(existing) : "";
            });
          });
        });
        setValues(init);
        // 既定車両: その日のシフト割当車両を最優先 > 既存report の車両。メーターは既存report のみ。
        const withExisting = list.find((s) => s.existing);
        const existingVid = withExisting?.existing?.vehicleId ?? null;
        const defaultVid = res.shiftVehicleId || existingVid || null;
        setVehicleId(defaultVid);
        if (withExisting?.existing?.meterValue != null) setMeter(String(withExisting.existing.meterValue));
        else setMeter("");
      } catch {
        if (!cancelled) setShifts([]);
      } finally {
        if (!cancelled) setFormLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportDate]);

  function setVal(courseId: string, unitId: string, fieldKey: string, v: string) {
    setValues((prev) => ({
      ...prev,
      [courseId]: { ...prev[courseId], [unitId]: { ...prev[courseId]?.[unitId], [fieldKey]: v } },
    }));
  }

  const meterNum = useMemo(() => (meter.trim() ? Number(meter) : null), [meter]);

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const items = shifts.map((s) => ({
        courseId: s.courseId,
        carrierId: s.carrierId,
        vehicleId,
        meterValue: meterNum,
        entries: s.units.flatMap((u) =>
          u.fields.map((f) => {
            const raw = values[s.courseId]?.[u.id]?.[f.fieldKey] ?? "";
            const isNumeric = f.inputType === "INT";
            return {
              unitId: u.id,
              fieldKey: f.fieldKey,
              valueNum: isNumeric ? (raw.trim() ? Number(raw) : 0) : null,
              valueText: isNumeric ? null : raw,
            };
          }),
        ),
      }));

      await apiFetch("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({
          reportDate: dateToReportDateStr(reportDate),
          driverIdentityId: selectedIdentityId,
          items,
        }),
      });
      setMessage({ kind: "ok", text: "日報を送信しました。" });
      // 送信後画面（今日の報酬見込み＋ランキング）
      try {
        const ps = await apiFetch<SubmitScreen>(
          `/api/me/submit-screen?date=${encodeURIComponent(dateToReportDateStr(reportDate))}`,
        );
        setPostSubmit(ps);
      } catch {
        /* 送信後画面の取得失敗は致命的でない */
      }
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "送信に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  if (postSubmit) {
    return <PostSubmitView data={postSubmit} onClose={() => setPostSubmit(null)} />;
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <h1 className="text-lg font-semibold text-slate-900">日報入力</h1>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">日付</label>
          <DatePicker value={reportDate} onChange={(d) => d && setReportDate(d)} />
        </div>

        {identities.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">勤務区分</label>
            <select value={selectedIdentityId ?? ""} onChange={(e) => setSelectedIdentityId(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded">
              {identities.map((i) => (
                <option key={i.id} value={i.id}>{i.label || i.driverCode}（{i.officeCode}）</option>
              ))}
            </select>
          </div>
        )}

        {/* 車両選択（カード式。紐付け車両＋当日シフト割当＋他の車両も選択可） */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">使用車両</label>
          {(() => {
            const allById = new Map<string, Vehicle>(
              [...vehicles, ...unlinkedVehicles].map((v) => [v.id, v]),
            );
            const linkedIds = new Set(vehicles.map((v) => v.id));
            const cards: Vehicle[] = [...vehicles];
            const sel = vehicleId ? allById.get(vehicleId) : null;
            if (sel && !linkedIds.has(sel.id)) cards.push(sel);
            if (showOtherVehicles) {
              for (const v of unlinkedVehicles) {
                if (!cards.some((c) => c.id === v.id)) cards.push(v);
              }
            }
            const hasMoreOthers = unlinkedVehicles.some((v) => !cards.some((c) => c.id === v.id));
            return (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                {cards.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVehicleId(v.id)}
                    className={`flex-shrink-0 w-48 rounded-lg border bg-white px-1 pt-1 pb-1 transition-colors ${
                      vehicleId === v.id ? "border-slate-900" : "border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <div className="w-[180px] mx-auto">
                      <VehiclePlate vehicle={v} selected={vehicleId === v.id} className="w-full max-w-[180px]" />
                    </div>
                    {!linkedIds.has(v.id) && (
                      <div className="text-[10px] text-slate-400 text-center leading-none mt-0.5">他の車両</div>
                    )}
                  </button>
                ))}
                {/* 他の車両を選択（未紐付け車両を展開） */}
                {hasMoreOthers && (
                  <button
                    type="button"
                    onClick={() => setShowOtherVehicles(true)}
                    className="flex-shrink-0 w-28 min-h-[3.5rem] rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-slate-400"
                  >
                    ＋ 他の車両
                    <br />
                    を選択
                  </button>
                )}
                {/* 車両なしで続ける */}
                <button
                  type="button"
                  onClick={() => setVehicleId(null)}
                  className={`flex-shrink-0 w-28 min-h-[3.5rem] rounded-lg border text-sm font-medium transition-colors ${
                    vehicleId === null
                      ? "border-slate-900 bg-slate-50 text-slate-900"
                      : "border-dashed border-slate-300 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  車両なしで
                  <br />
                  続ける
                </button>
              </div>
            );
          })()}
        </div>

        {/* メーター（車両選択あり & EV でない時のみ） */}
        {(() => {
          const sel =
            [...vehicles, ...unlinkedVehicles].find((v) => v.id === vehicleId) ?? null;
          if (!sel || sel.is_ev) return null;
          const prevKm = sel.current_mileage ?? 0;
          const placeholder = prevKm > 0 ? `前回: ${prevKm.toLocaleString("ja-JP")} km` : "例: 14567";
          const invalid = meter !== "" && prevKm > 0 && Number(meter) <= prevKm;
          return (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">メーター数値（km）</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder={placeholder}
                value={meter}
                onChange={(e) => setMeter(e.target.value.replace(/\D/g, ""))}
                className={`w-full py-3 px-4 text-lg font-mono border rounded-xl focus:outline-none focus:ring-2 ${
                  invalid ? "border-red-400 focus:ring-red-200" : "border-slate-200 focus:ring-brand-500"
                }`}
              />
              {invalid && (
                <p className="mt-1 text-xs text-red-500">
                  前回（{prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください
                </p>
              )}
            </div>
          );
        })()}
      </div>

      {formLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : shifts.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">この日のシフトがありません。</p>
      ) : (
        <div className="space-y-4">
          {shifts.map((s) => (
            <div key={s.courseId} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                <span className="font-medium text-slate-800">{s.courseName}</span>
                {s.carrierName && <span className="text-[11px] text-slate-400">{s.carrierName}</span>}
              </div>
              <div className="px-4 py-3 space-y-4">
                {s.units.length === 0 && <p className="text-xs text-slate-400">報告項目が設定されていません。</p>}
                {s.units.map((u) => (
                  <UnitFields key={u.id} unit={u} courseId={s.courseId} values={values} setVal={setVal} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {message && (
        <div className={`text-sm rounded px-3 py-2 ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message.text}</div>
      )}

      <button
        type="button"
        disabled={submitting || shifts.length === 0}
        onClick={submit}
        className="w-full py-3 rounded-lg bg-slate-900 text-white font-medium disabled:opacity-50"
      >
        {submitting ? "送信中…" : "送信"}
      </button>
    </div>
  );
}

function UnitFields({
  unit,
  courseId,
  values,
  setVal,
}: {
  unit: UnitDef;
  courseId: string;
  values: ValueMap;
  setVal: (courseId: string, unitId: string, fieldKey: string, v: string) => void;
}) {
  // group_label でグルーピング（null はグループなし）
  const groups = new Map<string, FieldDef[]>();
  unit.fields.forEach((f) => {
    const key = f.groupLabel ?? "";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  });

  return (
    <div>
      <div className="text-sm font-medium text-slate-700 mb-1.5">{unit.name}</div>
      <div className="space-y-2">
        {Array.from(groups.entries()).map(([groupKey, fields]) => (
          <div key={groupKey}>
            {groupKey && <div className="text-[11px] text-indigo-600 mb-1">{groupKey}</div>}
            <div className="grid grid-cols-2 gap-3">
              {fields.map((f) => {
                const val = values[courseId]?.[unit.id]?.[f.fieldKey] ?? "";
                // BOOL: カード内トグル
                if (f.inputType === "BOOL") {
                  return (
                    <label
                      key={f.fieldKey}
                      className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 p-4"
                    >
                      <input
                        type="checkbox"
                        checked={val === "true"}
                        onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.checked ? "true" : "false")}
                        className="h-5 w-5 accent-brand-700"
                      />
                      <span className="text-xs font-semibold text-slate-500">
                        {f.label}
                        {f.required && <span className="text-red-500 ml-0.5">*</span>}
                      </span>
                    </label>
                  );
                }
                // INT/TEXT/TIME: 旧フォーム同様のカード＋大きな数値入力
                const isInt = f.inputType === "INT";
                return (
                  <div key={f.fieldKey} className="bg-white rounded-xl border border-slate-200 p-4">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      {f.label}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type={isInt ? "number" : f.inputType === "TIME" ? "time" : "text"}
                      inputMode={isInt ? "numeric" : undefined}
                      min={isInt ? "0" : undefined}
                      placeholder={isInt ? "0" : ""}
                      value={val}
                      onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.value)}
                      className={
                        isInt
                          ? "w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                          : "w-full text-lg text-slate-900 py-2 border-0 focus:outline-none bg-transparent"
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 送信後画面: 今日の報酬見込み ＋ ランキング（チーム戦 or 個人）
// ============================================================
function PostSubmitView({ data, onClose }: { data: SubmitScreen; onClose: () => void }) {
  const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
  const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `${r}`);
  const r = data.ranking;

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <div className="text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-2 text-2xl">
          ✓
        </div>
        <h1 className="text-lg font-semibold text-slate-900">日報を送信しました</h1>
      </div>

      {/* 今日の報酬見込み */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
        <div className="text-xs text-slate-500">今日の報酬（見込み）</div>
        <CountUp
          value={data.todayReward}
          durationMs={900}
          prefix="¥"
          className="mt-1 block text-3xl font-bold text-brand-900 tabular-nums"
        />
        <div className="mt-1 text-[11px] text-slate-400">承認後に確定します</div>
      </div>

      {/* 今日獲得ポイント（チーム戦・採点ルールあり） */}
      {r && r.mode === "team" && (data.todayPoints ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
          <div className="text-xs text-amber-700">今日のチーム獲得ポイント</div>
          <CountUp
            value={data.todayPoints ?? 0}
            durationMs={900}
            prefix="+"
            suffix=" pt"
            className="mt-1 block text-3xl font-extrabold text-amber-500 tabular-nums"
          />
        </div>
      )}

      {/* 自チームのポイント（順位非公開時はこれのみ） */}
      {r && r.mode === "team" && r.rankingVisible === false && r.myTeam && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🏆</span>
            <span className="text-sm font-semibold text-slate-800">{r.eventName}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 ring-1 ring-slate-300">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ background: r.myTeam.color }} />
              <span className="font-semibold text-slate-800 truncate">{r.myTeam.name}</span>
              <span className="text-[10px] text-slate-500">(あなたのチーム)</span>
            </div>
            <span className="font-bold tabular-nums text-slate-900">{r.myTeam.total} pt</span>
          </div>
        </div>
      )}

      {/* ランキング（順位公開時のみ） */}
      {r && r.mode === "team" && r.rankingVisible !== false && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🏆</span>
            <span className="text-sm font-semibold text-slate-800">{r.eventName}</span>
          </div>
          <div className="space-y-1.5">
            {r.teams.map((t) => (
              <div
                key={t.teamId}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                  t.teamId === r.myTeamId ? "bg-slate-100 ring-1 ring-slate-300" : "bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 text-center">{medal(t.rank)}</span>
                  <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="font-semibold text-slate-800 truncate">{t.name}</span>
                  {t.teamId === r.myTeamId && <span className="text-[10px] text-slate-500">(自分)</span>}
                </div>
                <span className="font-bold tabular-nums text-slate-900">{t.total} pt</span>
              </div>
            ))}
          </div>
          {r.individuals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="text-[11px] font-medium text-slate-500 mb-1">個人トップ</div>
              {r.individuals.slice(0, 5).map((d) => (
                <div key={`${d.rank}-${d.name}`} className={`flex items-center justify-between text-xs px-1 py-0.5 ${d.isMe ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                  <span>{medal(d.rank)} {d.name}{d.isMe && " (あなた)"}</span>
                  <span className="tabular-nums">{d.total} pt</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {r && r.mode === "personal" && (
        r.configured ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">📊</span>
              <span className="text-sm font-semibold text-slate-800">今月の{r.metricLabel}ランキング</span>
            </div>
            <div className="space-y-1">
              {r.ranking.map((d) => (
                <div
                  key={`${d.rank}-${d.name}`}
                  className={`flex items-center justify-between rounded-lg px-3 py-1.5 ${d.isMe ? "bg-slate-100 ring-1 ring-slate-300 font-semibold text-slate-900" : "text-slate-600"}`}
                >
                  <span>{medal(d.rank)} {d.name}{d.isMe && " (あなた)"}</span>
                  <span className="tabular-nums">{d.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {r.myRank && r.myRank.rank > r.ranking.length && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between rounded-lg px-3 py-1.5 bg-slate-100 ring-1 ring-slate-300 font-semibold text-slate-900 text-sm">
                <span>{r.myRank.rank}位 {r.myRank.name} (あなた)</span>
                <span className="tabular-nums">{r.myRank.value.toLocaleString()}</span>
              </div>
            )}
            <div className="mt-2 text-[11px] text-slate-400 text-right">{r.total}名中</div>
          </div>
        ) : null
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full py-3 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
      >
        続けて入力する
      </button>
    </div>
  );
}
