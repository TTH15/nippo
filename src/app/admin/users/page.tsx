"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

type Course = { id: string; name: string; color: string };
type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
  role: string;
  company_code: string;
  office_code: string;
  driver_code: string;
  created_at: string;
  driver_courses: { course_id: string; courses: Course }[];
};

// 開発中の会社コード
const COMPANY_CODE = "AAA";

export default function UsersPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [form, setForm] = useState({
    name: "",
    displayName: "",
    officeCode: "",
    driverNumber: "", // 6桁の数字部分
    courseIds: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [companyCode, setCompanyCode] = useState(COMPANY_CODE);

  useEffect(() => {
    const stored = getStoredDriver();
    if (stored?.companyCode) {
      setCompanyCode(stored.companyCode);
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, coursesRes] = await Promise.all([
        apiFetch<{ drivers: Driver[] }>("/api/admin/users"),
        apiFetch<{ courses: Course[] }>("/api/admin/courses"),
      ]);
      // 同じ会社コードのドライバーのみ表示
      setDrivers(usersRes.drivers.filter(d => d.role === "DRIVER"));
      setCourses(coursesRes.courses);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditingDriver(null);
    setForm({ name: "", displayName: "", officeCode: "", driverNumber: "", courseIds: [] });
    setShowModal(true);
  };

  const openEdit = (d: Driver) => {
    setEditingDriver(d);
    setForm({
      name: d.name,
      displayName: d.display_name?.trim() ?? getDisplayName(d),
      officeCode: d.office_code || "",
      driverNumber: d.driver_code?.slice(3) || "",
      courseIds: d.driver_courses.map((dc) => dc.course_id),
    });
    setShowModal(true);
  };

  const toggleCourse = (cid: string) => {
    setForm((f) => ({
      ...f,
      courseIds: f.courseIds.includes(cid)
        ? f.courseIds.filter((id) => id !== cid)
        : [...f.courseIds, cid],
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const driverCode = companyCode + form.driverNumber;
      
      if (editingDriver) {
        await apiFetch(`/api/admin/users/${editingDriver.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name,
            displayName: form.displayName.trim() || null,
            officeCode: form.officeCode,
            driverCode,
            courseIds: form.courseIds,
          }),
        });
      } else {
        await apiFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            displayName: form.displayName.trim() || null,
            officeCode: form.officeCode,
            driverCode,
            companyCode,
            courseIds: form.courseIds,
          }),
        });
      }
      setShowModal(false);
      load();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const deleteDriver = async (id: string, name: string) => {
    if (!confirm(`${name}を削除しますか？`)) return;
    try {
      await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      console.error(e);
      alert("削除に失敗しました");
    }
  };

  const isFormValid = form.name.trim() && 
    form.officeCode.length === 6 && 
    /^\d{6}$/.test(form.officeCode) &&
    form.driverNumber.length === 6 && 
    /^\d{6}$/.test(form.driverNumber);

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">ユーザー管理</h1>
            <p className="text-sm text-slate-500 mt-0.5">会社コード: {companyCode}</p>
          </div>
          <button
            onClick={openNew}
            className="px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
          >
            新規追加
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : drivers.length === 0 ? (
          <p className="text-sm text-slate-500">ドライバーが登録されていません</p>
        ) : (
          <div className="bg-white rounded border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-2.5 px-4 text-left font-medium text-slate-600">名前</th>
                  <th className="py-2.5 px-4 text-left font-medium text-slate-600">表示名</th>
                  <th className="py-2.5 px-4 text-left font-medium text-slate-600">ドライバーコード</th>
                  <th className="py-2.5 px-4 text-left font-medium text-slate-600">事業所</th>
                  <th className="py-2.5 px-4 text-left font-medium text-slate-600">担当コース</th>
                  <th className="py-2.5 px-4 text-right font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-medium text-slate-800">{d.name}</td>
                    <td className="py-2.5 px-4 text-slate-600">{getDisplayName(d)}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{d.driver_code || "-"}</td>
                    <td className="py-2.5 px-4 text-slate-600">{d.office_code || "-"}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-wrap gap-1">
                        {d.driver_courses.map((dc) => (
                          <span
                            key={dc.course_id}
                            className="px-1.5 py-0.5 rounded text-xs text-white"
                            style={{ backgroundColor: dc.courses.color }}
                          >
                            {dc.courses.name}
                          </span>
                        ))}
                        {d.driver_courses.length === 0 && (
                          <span className="text-xs text-slate-400">未設定</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        onClick={() => openEdit(d)}
                        className="text-xs text-slate-500 hover:text-slate-800 mr-3 transition-colors"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => deleteDriver(d.id, d.name)}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingDriver ? "ユーザー編集" : "新規ユーザー追加"}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">名前</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">表示名</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="未入力なら苗字のみ表示"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <p className="text-xs text-slate-500 mt-1">シフト・日報などで表示します。空欄の場合は苗字のみ表示されます。</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">事業所コード（6桁）</label>
                <input
                  type="text"
                  maxLength={6}
                  value={form.officeCode}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm((f) => ({ ...f, officeCode: v }));
                  }}
                  placeholder="000001"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  ドライバーコード
                </label>
                <div className="flex items-center gap-1">
                  <span className="px-3 py-2 bg-slate-100 border border-slate-200 rounded text-sm font-mono text-slate-600">
                    {companyCode}
                  </span>
                  <input
                    type="text"
                    maxLength={6}
                    value={form.driverNumber}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setForm((f) => ({ ...f, driverNumber: v }));
                    }}
                    placeholder="123456"
                    disabled={!!editingDriver}
                    className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  この6桁がログイン時のPINになります
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">担当可能コース</label>
                <div className="flex flex-wrap gap-2">
                  {courses.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCourse(c.id)}
                      className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                        form.courseIds.includes(c.id)
                          ? "text-white border-transparent"
                          : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                      style={form.courseIds.includes(c.id) ? { backgroundColor: c.color } : {}}
                    >
                      {c.name}
                    </button>
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
                onClick={save}
                disabled={saving || !isFormValid}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
