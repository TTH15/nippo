"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";
import { faPenToSquare, faGripVertical } from "@fortawesome/free-solid-svg-icons";

type CourseCarrier = "YAMATO" | "AMAZON" | "OTHER";
type Course = { id: string; name: string; color: string; sort_order: number; max_drivers?: number | null; carrier?: CourseCarrier | null; summary_title?: string | null };
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
  takuhaibin_driver_payout: 150,
  nekopos_revenue: 40,
  nekopos_driver_payout: 30,
  fixed_revenue: 0,
  fixed_profit: 0,
};

const COLORS = [
  "#3b82f6", "#2563eb", "#0ea5e9", "#06b6d4", "#14b8a6",
  "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316",
  "#ef4444", "#dc2626", "#ec4899", "#d946ef", "#8b5cf6",
  "#6366f1", "#4f46e5", "#64748b", "#475569", "#334155",
];

export default function CoursesPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rates, setRates] = useState<CourseRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [editingRate, setEditingRate] = useState<CourseRate | null>(null);
  const [rateForm, setRateForm] = useState(INITIAL_RATE_FORM);
  const [newCourse, setNewCourse] = useState<{ name: string; color: string; max_drivers: string; carrier: CourseCarrier; summary_title: string }>({
    name: "",
    color: COLORS[0],
    max_drivers: "1",
    carrier: "OTHER",
    summary_title: "",
  });
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; color: string; max_drivers: string; carrier: CourseCarrier; summary_title: string }>({
    name: "",
    color: COLORS[0],
    max_drivers: "1",
    carrier: "OTHER",
    summary_title: "",
  });
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);
  const [reordering, setReordering] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const reorderCourses = async (newOrder: Course[]) => {
    if (!canWrite) return;
    setReordering(true);
    try {
      await apiFetch("/api/admin/courses", {
        method: "PATCH",
        body: JSON.stringify({ order: newOrder.map((c) => c.id) }),
      });
      setCourses(newOrder);
      load(); // 単価テーブルの順序も同期
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "並べ替えに失敗しました",
        message: "コースの並べ替えを保存できませんでした。もう一度お試しください。",
        detail: reason || undefined,
      });
    } finally {
      setReordering(false);
    }
  };

  const handleCourseDragStart = (e: React.DragEvent, index: number) => {
    if (!canWrite) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.setData("application/json", JSON.stringify({ index }));
  };

  const handleCourseDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleCourseDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleCourseDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (!canWrite) return;
    const srcIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (Number.isNaN(srcIndex) || srcIndex === targetIndex) return;
    const newOrder = [...courses];
    const [removed] = newOrder.splice(srcIndex, 1);
    newOrder.splice(targetIndex, 0, removed);
    reorderCourses(newOrder);
  };

  const handleCourseDragEnd = () => {
    setDragOverIndex(null);
  };

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
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    load();
  }, []);

  const addCourse = async () => {
    if (!canWrite) return;
    if (!newCourse.name.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({
          name: newCourse.name.trim(),
          color: newCourse.color,
          max_drivers: Math.max(1, parseInt(newCourse.max_drivers, 10) || 1),
          carrier: newCourse.carrier,
          summary_title: newCourse.summary_title.trim() ? newCourse.summary_title.trim() : null,
        }),
      });
      setShowModal(false);
      setNewCourse({ name: "", color: COLORS[0], max_drivers: "1", carrier: "OTHER", summary_title: "" });
      load();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "コースの追加に失敗しました",
        message:
          "サーバーでエラーが発生したため、新しいコースを追加できませんでした。\n\n" +
          "コース名が重複していないかなど入力内容を確認し、もう一度追加してください。\n" +
          "同じエラーが続く場合は、システム管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const openEditCourse = (course: Course) => {
    if (!canWrite) return;
    setEditingCourse(course);
    setEditForm({
      name: course.name,
      color: course.color || COLORS[0],
      max_drivers: String(Math.max(1, course.max_drivers ?? 1)),
      carrier: course.carrier === "YAMATO" || course.carrier === "AMAZON" ? course.carrier : "OTHER",
      summary_title: course.summary_title ?? "",
    });
    setShowEditModal(true);
  };

  const saveCourseEdit = async () => {
    if (!canWrite || !editingCourse) return;
    if (!editForm.name.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/courses/${editingCourse.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editForm.name.trim(),
          color: editForm.color,
          max_drivers: Math.max(1, parseInt(editForm.max_drivers, 10) || 1),
          carrier: editForm.carrier,
          summary_title: editForm.summary_title.trim() ? editForm.summary_title.trim() : null,
        }),
      });
      setShowEditModal(false);
      setEditingCourse(null);
      load();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "コースの保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、コース情報を保存できませんでした。\n\n" +
          "入力内容（コース名の重複など）を確認し、もう一度保存してください。\n" +
          "同じエラーが続く場合は、システム管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const openRateModal = (r: CourseRate) => {
    if (!canWrite) return;
    setEditingRate(r);
    setRateForm({
      takuhaibin_revenue: r.takuhaibin_revenue,
      takuhaibin_driver_payout: r.takuhaibin_driver_payout,
      nekopos_revenue: r.nekopos_revenue,
      nekopos_driver_payout: r.nekopos_driver_payout,
      fixed_revenue: r.fixed_revenue,
      fixed_profit: r.fixed_profit,
    });
    setShowRateModal(true);
  };

  const saveRate = async () => {
    if (!canWrite) return;
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
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "単価設定の保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、単価設定を保存できませんでした。\n\n" +
          "入力した金額に不正な値がないか確認し、もう一度保存してください。\n" +
          "同じエラーが続く場合は、システム管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const getDriversForCourse = (courseId: string) => {
    return drivers.filter((d) =>
      d.driver_courses.some((dc) => dc.course_id === courseId)
    );
  };

  const deleteCourse = async (courseId: string, name: string) => {
    if (!canWrite) return;
    setConfirmState({
      message: `${name} を削除しますか？\n関連するシフトや単価も削除されます。`,
      onConfirm: async () => {
        setSaving(true);
        try {
          await apiFetch(`/api/admin/courses/${courseId}`, {
            method: "DELETE",
          });
          load();
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "コースの削除に失敗しました",
            message:
              "サーバーでエラーが発生したため、このコースを削除できませんでした。\n\n" +
              "このコースに紐付いたシフトやドライバーが原因の可能性があります。時間をおいて再度お試しいただくか、システム管理者に連絡してください。",
            detail: reason || undefined,
          });
        } finally {
          setSaving(false);
        }
      },
    });
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">コース管理</h1>
          {canWrite && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規追加
            </button>
          )}
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
                        {canWrite && (
                          <button onClick={() => openRateModal(r)} className="text-slate-600 hover:text-slate-900 text-xs">
                            <FontAwesomeIcon icon={faPenToSquare} />
                          </button>
                        )}
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
            {courses.map((course, index) => {
              const assignedDrivers = getDriversForCourse(course.id);
              const isDragOver = dragOverIndex === index;
              return (
                <div
                  key={course.id}
                  draggable={canWrite && !reordering}
                  onDragStart={(e) => handleCourseDragStart(e, index)}
                  onDragOver={(e) => handleCourseDragOver(e, index)}
                  onDragLeave={handleCourseDragLeave}
                  onDrop={(e) => handleCourseDrop(e, index)}
                  onDragEnd={handleCourseDragEnd}
                  className={`bg-white rounded border border-slate-200 p-4 border-l-4 transition-all ${
                    canWrite && !reordering ? "cursor-grab active:cursor-grabbing" : ""
                  } ${isDragOver ? "ring-2 ring-slate-400 ring-offset-2" : ""}`}
                  style={{ borderLeftColor: course.color }}
                >
                  <div className="flex items-center justify-between gap-3">
                    {canWrite && !reordering && (
                      <div
                        className="shrink-0 text-slate-400 hover:text-slate-600 touch-none"
                        title="ドラッグして並べ替え"
                      >
                        <FontAwesomeIcon icon={faGripVertical} className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
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
                    <div className="flex items-center gap-3 shrink-0">
                      <div
                        className="w-5 h-5 rounded-full shrink-0"
                        style={{ backgroundColor: course.color }}
                      />
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditCourse(course)}
                          className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          <FontAwesomeIcon icon={faPenToSquare} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">新規コース追加</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">キャリア</label>
                <select
                  value={newCourse.carrier}
                  onChange={(e) => setNewCourse((f) => ({ ...f, carrier: e.target.value as CourseCarrier }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="YAMATO">ヤマト</option>
                  <option value="AMAZON">Amazon</option>
                  <option value="OTHER">その他</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">略記（集計・シフト表示用）</label>
                <input
                  type="text"
                  value={newCourse.summary_title}
                  onChange={(e) => setNewCourse((f) => ({ ...f, summary_title: e.target.value }))}
                  placeholder="例: 横大路、Amazon 昼"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <p className="mt-1 text-xs text-slate-500">売上集計タブおよびドライバー側のシフト確認でこの略記が使われます。未入力の場合はコース名を表示します。</p>
              </div>
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
                <label className="block text-sm font-medium text-slate-700 mb-1">1日あたりの最大人数</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={newCourse.max_drivers}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setNewCourse((f) => ({ ...f, max_drivers: v }));
                  }}
                  placeholder="1"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">色</label>
                <div className="flex flex-wrap gap-2 mb-2">
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
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-slate-500">または</span>
                  <input
                    type="color"
                    value={newCourse.color}
                    onChange={(e) => setNewCourse((f) => ({ ...f, color: e.target.value }))}
                    className="w-9 h-9 rounded border border-slate-200 cursor-pointer p-0.5 bg-white"
                    title="好きな色を選択"
                  />
                  <span className="text-xs text-slate-500">好きな色を選択</span>
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

      {/* コース編集モーダル */}
      {showEditModal && editingCourse && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">コース編集</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">キャリア</label>
                <select
                  value={editForm.carrier}
                  onChange={(e) => setEditForm((f) => ({ ...f, carrier: e.target.value as CourseCarrier }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="YAMATO">ヤマト</option>
                  <option value="AMAZON">Amazon</option>
                  <option value="OTHER">その他</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">略記（集計・シフト表示用）</label>
                <input
                  type="text"
                  value={editForm.summary_title}
                  onChange={(e) => setEditForm((f) => ({ ...f, summary_title: e.target.value }))}
                  placeholder="例: 横大路、Amazon 昼"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <p className="mt-1 text-xs text-slate-500">売上集計タブおよびドライバー側のシフト確認でこの略記が使われます。未入力の場合はコース名を表示します。</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">コース名</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">色</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditForm((f) => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${editForm.color === c ? "border-slate-900 scale-110" : "border-transparent"
                        }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-slate-500">または</span>
                  <input
                    type="color"
                    value={editForm.color}
                    onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                    className="w-9 h-9 rounded border border-slate-200 cursor-pointer p-0.5 bg-white"
                    title="好きな色を選択"
                  />
                  <span className="text-xs text-slate-500">好きな色を選択</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">1日あたりの最大人数</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={editForm.max_drivers}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setEditForm((f) => ({ ...f, max_drivers: v }));
                  }}
                  placeholder="1"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-6">
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingCourse(null);
                  }}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={saveCourseEdit}
                  disabled={saving || !editForm.name.trim()}
                  className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>

              <div className="pt-3 border-t border-slate-200">
                <button
                  onClick={() => {
                    deleteCourse(editingCourse.id, editingCourse.name);
                    setShowEditModal(false);
                    setEditingCourse(null);
                  }}
                  className="w-full px-4 py-2 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
                >
                  削除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 単価編集モーダル */}
      {showRateModal && editingRate && canWrite && (
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
                  <label className="block text-slate-600 mb-1">宅急便 支払(円)</label>
                  <input type="number" value={rateForm.takuhaibin_driver_payout} onChange={(e) => setRateForm((f) => ({ ...f, takuhaibin_driver_payout: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">宅急便 利益(円)</label>
                  <div className="w-full px-2 py-1.5 border rounded bg-slate-50 text-right">
                    {rateForm.takuhaibin_revenue - rateForm.takuhaibin_driver_payout}円
                  </div>
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ネコポス 売上(円)</label>
                  <input type="number" value={rateForm.nekopos_revenue} onChange={(e) => setRateForm((f) => ({ ...f, nekopos_revenue: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ネコポス 支払(円)</label>
                  <input type="number" value={rateForm.nekopos_driver_payout} onChange={(e) => setRateForm((f) => ({ ...f, nekopos_driver_payout: Number(e.target.value) || 0 }))} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ネコポス 利益(円)</label>
                  <div className="w-full px-2 py-1.5 border rounded bg-slate-50 text-right">
                    {rateForm.nekopos_revenue - rateForm.nekopos_driver_payout}円
                  </div>
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
      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => { })}
        onClose={() => setConfirmState(null)}
        confirmLabel="削除"
      />
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
    </AdminLayout>
  );
}
