"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

type Course = { id: string; name: string; color: string; sort_order: number };
type CourseRate = {
  id: string;
  course_id: string;
  takuhaibin_revenue: number;
  takuhaibin_profit: number;
  takuhaibin_driver_payout: number;
  nekopos_revenue: number;
  nekopos_profit: number;
  nekopos_driver_payout: number;
  fixed_revenue: number;
  fixed_profit: number;
  courses: { id: string; name: string; color: string } | null;
};
type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
  role: string;
  driver_courses: { course_id: string; courses: { id: string; name: string; color: string } }[];
};

const INITIAL_RATE_FORM = {
  takuhaibin_revenue: 160,
  takuhaibin_profit: 10,
  takuhaibin_driver_payout: 150,
  nekopos_revenue: 40,
  nekopos_profit: 10,
  nekopos_driver_payout: 30,
  fixed_revenue: 0,
  fixed_profit: 0,
};

const COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#64748b",
];

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rates, setRates] = useState<CourseRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [editingRate, setEditingRate] = useState<CourseRate | null>(null);
  const [rateForm, setRateForm] = useState(INITIAL_RATE_FORM);
  const [newCourse, setNewCourse] = useState({ name: "", color: COLORS[0] });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [coursesRes, usersRes, ratesRes] = await Promise.all([
        apiFetch<{ courses: Course[] }>("/api/admin/courses"),
        apiFetch<{ drivers: Driver[] }>("/api/admin/users"),
        apiFetch<{ rates: CourseRate[] }>("/api/admin/course-rates"),
      ]);
      setCourses(coursesRes.courses);
      setDrivers(usersRes.drivers.filter((d) => d.role === "DRIVER"));
      setRates(ratesRes.rates ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addCourse = async () => {
    if (!newCourse.name.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify(newCourse),
      });
      setShowModal(false);
      setNewCourse({ name: "", color: COLORS[0] });
      load();
    } catch (e) {
      console.error(e);
      alert("追加に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const openRateModal = (r: CourseRate) => {
    setEditingRate(r);
    setRateForm({
      takuhaibin_revenue: r.takuhaibin_revenue,
      takuhaibin_profit: r.takuhaibin_profit,
      takuhaibin_driver_payout: r.takuhaibin_driver_payout,
      nekopos_revenue: r.nekopos_revenue,
      nekopos_profit: r.nekopos_profit,
      nekopos_driver_payout: r.nekopos_driver_payout,
      fixed_revenue: r.fixed_revenue,
      fixed_profit: r.fixed_profit,
    });
    setShowRateModal(true);
  };

  const saveRate = async () => {
    if (!editingRate) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/course-rates", {
        method: "PATCH",
        body: JSON.stringify({ course_id: editingRate.course_id, ...rateForm }),
      });
      setShowRateModal(false);
      setEditingRate(null);
      load();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const getDriversForCourse = (courseId: string) => {
    return drivers.filter((d) =>
      d.driver_courses.some((dc) => dc.course_id === courseId)
    );
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">コース管理</h1>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
          >
            <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
            新規追加
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-4">
          ドライバーとコースの紐付けは「ユーザー管理」で行います
        </p>

        {/* コース単価 */}
        {rates.length > 0 && (
          <div className="mb-8">
            <h2 className="text-base font-semibold text-slate-800 mb-3">コース単価</h2>
            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">コース</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">宅急便 売上</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">宅急便 利益</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">宅急便 支払</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">ネコポス 売上</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">ネコポス 利益</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">ネコポス 支払</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">固定 売上</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-700">固定 利益</th>
                    <th className="px-3 py-2 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: (r.courses as { color?: string })?.color ?? "#94a3b8" }} />
                          {(r.courses as { name?: string })?.name ?? "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{r.takuhaibin_revenue}円</td>
                      <td className="px-3 py-2 text-right">{r.takuhaibin_profit}円</td>
                      <td className="px-3 py-2 text-right">{r.takuhaibin_driver_payout}円</td>
                      <td className="px-3 py-2 text-right">{r.nekopos_revenue}円</td>
                      <td className="px-3 py-2 text-right">{r.nekopos_profit}円</td>
                      <td className="px-3 py-2 text-right">{r.nekopos_driver_payout}円</td>
                      <td className="px-3 py-2 text-right">{r.fixed_revenue > 0 ? `${r.fixed_revenue}円` : "-"}</td>
                      <td className="px-3 py-2 text-right">{r.fixed_profit > 0 ? `${r.fixed_profit}円` : "-"}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => openRateModal(r)} className="text-slate-600 hover:text-slate-900 text-xs">編集</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded border border-slate-200 p-4 border-l-4 border-l-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <Skeleton className="h-4 w-24 mb-1.5" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                  <Skeleton className="w-5 h-5 rounded-full shrink-0" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {courses.map((course) => {
              const assignedDrivers = getDriversForCourse(course.id);
              return (
                <div
                  key={course.id}
                  className="bg-white rounded border border-slate-200 p-4 border-l-4"
                  style={{ borderLeftColor: course.color }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-slate-900">{course.name}</h3>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {assignedDrivers.length > 0 ? (
                          assignedDrivers.map((d) => (
                            <span
                              key={d.id}
                              className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded"
                            >
                              {getDisplayName(d)}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">担当ドライバー未設定</span>
                        )}
                      </div>
                    </div>
                    <div
                      className="w-5 h-5 rounded-full shrink-0"
                      style={{ backgroundColor: course.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">新規コース追加</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">コース名</label>
                <input
                  type="text"
                  value={newCourse.name}
                  onChange={(e) => setNewCourse((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例: ヤマトD"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">色</label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewCourse((f) => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${newCourse.color === c ? "border-slate-900 scale-110" : "border-transparent"
                        }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={addCourse}
                disabled={saving || !newCourse.name.trim()}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "追加中..." : "追加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 単価編集モーダル */}
      {showRateModal && editingRate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              単価設定 - {(editingRate.courses as { name?: string })?.name ?? ""}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <label className="block text-slate-600 mb-1">宅急便 売上(円)</label>
                  <input type="number" value={rateForm.takuhaibin_revenue} onChange={(e) => setRateForm((f) => ({ ...f, takuhaibin_revenue: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">宅急便 利益(円)</label>
                  <input type="number" value={rateForm.takuhaibin_profit} onChange={(e) => setRateForm((f) => ({ ...f, takuhaibin_profit: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">宅急便 支払(円)</label>
                  <input type="number" value={rateForm.takuhaibin_driver_payout} onChange={(e) => setRateForm((f) => ({ ...f, takuhaibin_driver_payout: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ネコポス 売上(円)</label>
                  <input type="number" value={rateForm.nekopos_revenue} onChange={(e) => setRateForm((f) => ({ ...f, nekopos_revenue: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ネコポス 利益(円)</label>
                  <input type="number" value={rateForm.nekopos_profit} onChange={(e) => setRateForm((f) => ({ ...f, nekopos_profit: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ネコポス 支払(円)</label>
                  <input type="number" value={rateForm.nekopos_driver_payout} onChange={(e) => setRateForm((f) => ({ ...f, nekopos_driver_payout: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">固定 売上(円)</label>
                  <input type="number" value={rateForm.fixed_revenue} onChange={(e) => setRateForm((f) => ({ ...f, fixed_revenue: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" placeholder="Amazon等" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">固定 利益(円)</label>
                  <input type="number" value={rateForm.fixed_profit} onChange={(e) => setRateForm((f) => ({ ...f, fixed_profit: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => { setShowRateModal(false); setEditingRate(null); }} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">キャンセル</button>
              <button onClick={saveRate} disabled={saving} className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
