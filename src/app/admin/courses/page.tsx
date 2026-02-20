"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

type Course = { id: string; name: string; color: string; sort_order: number };
type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
  role: string;
  driver_courses: { course_id: string; courses: { id: string; name: string; color: string } }[];
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
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newCourse, setNewCourse] = useState({ name: "", color: COLORS[0] });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [coursesRes, usersRes] = await Promise.all([
        apiFetch<{ courses: Course[] }>("/api/admin/courses"),
        apiFetch<{ drivers: Driver[] }>("/api/admin/users"),
      ]);
      setCourses(coursesRes.courses);
      setDrivers(usersRes.drivers.filter((d) => d.role === "DRIVER"));
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

  const getDriversForCourse = (courseId: string) => {
    return drivers.filter((d) =>
      d.driver_courses.some((dc) => dc.course_id === courseId)
    );
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">コース管理</h1>
          <button
            onClick={() => setShowModal(true)}
            className="px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
          >
            新規追加
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-4">
          ドライバーとコースの紐付けは「ユーザー管理」で行います
        </p>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
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
    </AdminLayout>
  );
}
