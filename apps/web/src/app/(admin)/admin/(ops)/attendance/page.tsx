"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation, faLocationDot, faLocationCrosshairs } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { DatePicker } from "@/lib/components/DatePicker";
import { apiFetch } from "@/lib/api";
import { hasCapability } from "@/lib/capabilities";
import { Button } from "@/lib/ui/button";

type AttendanceRow = {
  id: string;
  driverName: string;
  plate: string;
  purpose: string;
  status: "open" | "closed";
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
  distance: number | null;
  startMethod: string | null;
  endMethod: string | null;
  startGpsStatus: string | null;
  endGpsStatus: string | null;
  approvalStatus: string | null;
};

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  } catch {
    return "—";
  }
}

function durationLabel(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

// GPS未取得（権限OFF/取得失敗/未記録）を「要注意」として返す
function gpsWarn(s: string | null): null | { label: string } {
  if (s === "captured") return null;
  if (s === "denied") return { label: "権限OFF" };
  if (s === "unavailable") return { label: "GPS取得失敗" };
  return { label: "GPS無し" };
}

const PURPOSE_LABEL: Record<string, string> = { work: "稼働", move: "移動・整備", private: "私用" };

export default function AttendancePage() {
  const [date, setDate] = useState<Date>(new Date());
  const [items, setItems] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_vehicles"));
  }, []);

  const ymd = format(date, "yyyy-MM-dd");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: AttendanceRow[] }>(`/api/admin/attendance?date=${ymd}`);
      setItems(res.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [ymd]);

  useEffect(() => {
    load();
  }, [load]);

  function decide(id: string, action: "approve" | "reject") {
    // 楽観的更新: クリックで即座に承認状態を反映し、保存はバックグラウンドで進める
    const nextStatus = action === "approve" ? "approved" : "rejected";
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, approvalStatus: nextStatus } : r)));
    setBusyId(id);
    apiFetch(`/api/admin/attendance/${id}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    })
      .catch(() => {
        void load(); // 失敗時はサーバーの値に巻き戻す
      })
      .finally(() => setBusyId(null));
  }

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-slate-900">勤怠</h1>
          <DatePicker value={date} onChange={(d) => d && setDate(d)} />
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400">読み込み中…</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-slate-400">この日の勤怠はありません</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-xs">
                  <th className="text-left font-medium px-3 py-2.5">ドライバー</th>
                  <th className="text-left font-medium px-3 py-2.5">車両</th>
                  <th className="text-left font-medium px-3 py-2.5">出勤</th>
                  <th className="text-left font-medium px-3 py-2.5">退勤</th>
                  <th className="text-left font-medium px-3 py-2.5">稼働</th>
                  <th className="text-left font-medium px-3 py-2.5">メーター</th>
                  <th className="text-left font-medium px-3 py-2.5">状態</th>
                  <th className="text-right font-medium px-3 py-2.5">承認</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const qrUnused = r.startMethod !== "qr" || (r.endedAt != null && r.endMethod !== "qr");
                  const sg = gpsWarn(r.startGpsStatus);
                  const eg = r.endedAt ? gpsWarn(r.endGpsStatus) : null;
                  return (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{r.driverName}</td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {r.plate || "—"}
                        {r.purpose !== "work" && (
                          <span className="ml-1.5 text-[11px] text-slate-400">
                            {PURPOSE_LABEL[r.purpose] ?? r.purpose}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{hhmm(r.startedAt)}</td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {r.status === "open" ? (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            未退勤
                          </span>
                        ) : (
                          hhmm(r.endedAt)
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{durationLabel(r.durationMin)}</td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {r.startOdometer ?? "—"}
                        {r.endOdometer != null && ` → ${r.endOdometer}`}
                        {r.distance != null && (
                          <span className="ml-1.5 text-[11px] text-slate-400">(+{r.distance}km)</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {qrUnused && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-rose-50 text-rose-700">
                              <FontAwesomeIcon icon={faTriangleExclamation} className="w-2.5 h-2.5" />
                              QR未使用(要確認)
                            </span>
                          )}
                          {sg && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500">
                              <FontAwesomeIcon icon={faLocationCrosshairs} className="w-2.5 h-2.5" />
                              出{sg.label}
                            </span>
                          )}
                          {eg && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500">
                              <FontAwesomeIcon icon={faLocationDot} className="w-2.5 h-2.5" />
                              退{eg.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {r.approvalStatus === "pending" ? (
                          canWrite ? (
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                onClick={() => decide(r.id, "approve")}
                                disabled={busyId === r.id}
                              >
                                承認
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => decide(r.id, "reject")}
                                disabled={busyId === r.id}
                              >
                                却下
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-amber-700">承認待ち</span>
                          )
                        ) : r.approvalStatus === "approved" ? (
                          <span className="text-[11px] text-green-700">承認済</span>
                        ) : r.approvalStatus === "rejected" ? (
                          <span className="text-[11px] text-rose-600">却下</span>
                        ) : (
                          <span className="text-[11px] text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
