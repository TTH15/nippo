"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faChevronRight,
  faGripVertical,
  faCat,
  faTruck,
} from "@fortawesome/free-solid-svg-icons";
import { faAmazon } from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { CourseRateEditor, type CourseRateEditorHandle } from "@/lib/components/CourseRateEditor";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";
import { slotDisplayLabel } from "@/lib/timeSlot";
import { Button } from "@/lib/ui/button";

type CourseCarrier = "YAMATO" | "AMAZON" | "OTHER";
type Course = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  max_drivers?: number | null;
  carrier?: CourseCarrier | null;
  carrier_id?: string | null;
  summary_title?: string | null;
  daily_lease?: number | null;
  principal_invoice_address_id?: string | null;
  counterparty_invoice_address_id?: string | null;
  slot_id?: string | null;
};

type TimeSlot = { id: string; name: string; startTime: string | null; endTime: string | null };
type InvoiceAddress = { id: string; name: string };
type Carrier = { id: string; name: string; code: string | null };
type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
  role: string;
  driver_identities?: {
    driver_courses: { course_id: string; courses: { id: string; name: string; color: string } }[];
  }[];
  driver_courses?: { course_id: string; courses: { id: string; name: string; color: string } }[];
};

function driverHasCourse(d: Driver, courseId: string): boolean {
  if (d.driver_identities?.length) {
    return d.driver_identities.some((idn) =>
      (idn.driver_courses ?? []).some((dc) => dc.course_id === courseId),
    );
  }
  return (d.driver_courses ?? []).some((dc) => dc.course_id === courseId);
}

/** キャリアのアイコン（ヤマト=ネコ / Amazon=Amazonロゴ / その他=トラック） */
function carrierIcon(code: string | null): IconDefinition {
  if (code === "YAMATO") return faCat;
  if (code === "AMAZON") return faAmazon;
  return faTruck;
}

const NO_CARRIER_KEY = "__none__";

/** 時間帯セレクトのラベル（便名＋時刻があれば併記）。 */
function slotOptionLabel(s: TimeSlot): string {
  const t = slotDisplayLabel(s);
  return t === s.name ? s.name : `${s.name}（${t}）`;
}

const COLORS = [
  "#3b82f6", "#2563eb", "#0ea5e9", "#06b6d4", "#14b8a6",
  "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316",
  "#ef4444", "#dc2626", "#ec4899", "#d946ef", "#8b5cf6",
  "#6366f1", "#4f46e5", "#64748b", "#475569", "#334155",
];

type CourseFormState = {
  name: string;
  color: string;
  max_drivers: string;
  carrierId: string;
  summary_title: string;
  daily_lease: string;
  principal_invoice_address_id: string;
  counterparty_invoice_address_id: string;
  slotId: string;
};

const EMPTY_COURSE_FORM: CourseFormState = {
  name: "",
  color: COLORS[0],
  max_drivers: "1",
  carrierId: "",
  summary_title: "",
  daily_lease: "",
  principal_invoice_address_id: "",
  counterparty_invoice_address_id: "",
  slotId: "",
};

export default function CoursesPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [invoiceAddresses, setInvoiceAddresses] = useState<InvoiceAddress[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  // 選択キャリアから旧 carrier テキスト(YAMATO/AMAZON/OTHER)を導出（移行期の互換用）
  const legacyCarrierOf = (carrierId: string): CourseCarrier => {
    const code = carriers.find((c) => c.id === carrierId)?.code;
    return code === "YAMATO" || code === "AMAZON" ? code : "OTHER";
  };
  const [showModal, setShowModal] = useState(false);
  // 編集モーダルに埋め込む単価エディタ（保存時に ref 経由で course-billing を保存）
  const billingRef = useRef<CourseRateEditorHandle>(null);
  const createBillingRef = useRef<CourseRateEditorHandle>(null);
  const [newCourse, setNewCourse] = useState<CourseFormState>(EMPTY_COURSE_FORM);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editForm, setEditForm] = useState<CourseFormState>(EMPTY_COURSE_FORM);

  const principalNameById = useMemo(() => {
    return new Map(invoiceAddresses.map((a) => [a.id, a.name]));
  }, [invoiceAddresses]);
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // キャリア別にコースをグルーピング（カラム=キャリアマスタ順、未設定は末尾）
  const carrierGroups = useMemo(() => {
    const byCarrier = new Map<string, Course[]>();
    for (const c of courses) {
      const key = c.carrier_id ?? NO_CARRIER_KEY;
      const arr = byCarrier.get(key) ?? [];
      arr.push(c);
      byCarrier.set(key, arr);
    }
    const groups: { key: string; name: string; code: string | null; courses: Course[] }[] = [];
    const consumed = new Set<string>();
    carriers.forEach((cr) => {
      const arr = byCarrier.get(cr.id);
      if (arr && arr.length) {
        groups.push({ key: cr.id, name: cr.name, code: cr.code, courses: arr });
        consumed.add(cr.id);
      }
    });
    // マスタに無い carrier_id（想定外）も拾う
    for (const [key, arr] of byCarrier) {
      if (key === NO_CARRIER_KEY || consumed.has(key)) continue;
      groups.push({ key, name: "不明なキャリア", code: null, courses: arr });
    }
    const none = byCarrier.get(NO_CARRIER_KEY);
    if (none && none.length) {
      groups.push({ key: NO_CARRIER_KEY, name: "キャリア未設定", code: null, courses: none });
    }
    return groups;
  }, [courses, carriers]);

  const reorderCourses = async (newOrder: Course[]) => {
    if (!canWrite) return;
    const prev = courses;
    setReordering(true);
    setCourses(newOrder); // 楽観的反映
    try {
      await apiFetch("/api/admin/courses", {
        method: "PATCH",
        body: JSON.stringify({ order: newOrder.map((c) => c.id) }),
      });
    } catch (e) {
      console.error(e);
      setCourses(prev); // 巻き戻し
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

  // グループ内での並べ替え。グローバル順序のスロットを維持したまま入れ替える。
  const reorderWithinGroup = (groupCourses: Course[], srcId: string, targetId: string) => {
    if (srcId === targetId) return;
    const arr = [...groupCourses];
    const from = arr.findIndex((c) => c.id === srcId);
    const to = arr.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const ids = new Set(arr.map((c) => c.id));
    const slots: number[] = [];
    courses.forEach((c, i) => {
      if (ids.has(c.id)) slots.push(i);
    });
    const next = [...courses];
    slots.forEach((slotIdx, k) => {
      next[slotIdx] = arr[k];
    });
    void reorderCourses(next);
  };

  // SWR で5エンドポイントをまとめて1キーにキャッシュし、遷移をまたいで保持する。
  // courses は楽観更新（reorder/作成/編集/削除）で setCourses するため state を維持し、
  // 取得結果は同期エフェクトで流し込む。
  const {
    data: bundle,
    isInitialLoading,
  } = useApi<{
    courses: Course[];
    drivers: Driver[];
    addresses: InvoiceAddress[];
    carriers: { id: string; name: string; code: string | null }[];
    slots: TimeSlot[];
  }>("admin/courses:bundle", {
    fetcher: async () => {
      const [coursesRes, usersRes, invoiceAddressesRes, carriersRes, slotsRes] = await Promise.all([
        apiFetch<{ courses: Course[] }>("/api/admin/courses"),
        apiFetch<{ drivers: Driver[] }>("/api/admin/users"),
        apiFetch<{ addresses: InvoiceAddress[] }>("/api/admin/invoice-addresses"),
        apiFetch<{ carriers: Carrier[] }>("/api/admin/carriers"),
        apiFetch<{ slots: TimeSlot[] }>("/api/admin/shift-slots").catch(() => ({
          slots: [] as TimeSlot[],
        })),
      ]);
      return {
        courses: coursesRes.courses,
        drivers: usersRes.drivers.filter((d) => d.role === "DRIVER"),
        addresses: invoiceAddressesRes.addresses ?? [],
        carriers: (carriersRes.carriers ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code ?? null,
        })),
        slots: slotsRes.slots ?? [],
      };
    },
  });

  const loading = isInitialLoading;

  useEffect(() => {
    if (!bundle) return;
    setCourses(bundle.courses);
    setDrivers(bundle.drivers);
    setInvoiceAddresses(bundle.addresses);
    setCarriers(bundle.carriers);
    setSlots(bundle.slots);
  }, [bundle]);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  const addCourse = async () => {
    if (!canWrite) return;
    if (!newCourse.name.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ course: Course }>("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({
          name: newCourse.name.trim(),
          color: newCourse.color,
          max_drivers: Math.max(1, parseInt(newCourse.max_drivers, 10) || 1),
          carrier_id: newCourse.carrierId || null,
          carrier: legacyCarrierOf(newCourse.carrierId),
          summary_title: newCourse.summary_title.trim() ? newCourse.summary_title.trim() : null,
          daily_lease: Math.max(0, parseInt(newCourse.daily_lease, 10) || 0),
          principal_invoice_address_id: newCourse.principal_invoice_address_id || null,
          counterparty_invoice_address_id: newCourse.counterparty_invoice_address_id || null,
          slot_id: newCourse.slotId || null,
        }),
      });
      const createdCourse: Course = res.course;
      // 作成直後に、埋め込み単価フォームの内容を新コースID宛に保存。
      await createBillingRef.current?.save(createdCourse.id);
      const nextCourses = [...courses, createdCourse].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setCourses(nextCourses);
      setShowModal(false);
      setNewCourse(EMPTY_COURSE_FORM);
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
      carrierId: course.carrier_id ?? "",
      summary_title: course.summary_title ?? "",
      daily_lease: course.daily_lease != null && Number(course.daily_lease) > 0 ? String(course.daily_lease) : "",
      principal_invoice_address_id: course.principal_invoice_address_id ?? "",
      counterparty_invoice_address_id: course.counterparty_invoice_address_id ?? "",
      slotId: course.slot_id ?? "",
    });
    setShowEditModal(true);
  };

  const saveCourseEdit = async () => {
    if (!canWrite || !editingCourse) return;
    if (!editForm.name.trim()) return;
    setSaving(true);
    try {
      const dailyLease = Math.max(0, parseInt(editForm.daily_lease, 10) || 0);
      await apiFetch(`/api/admin/courses/${editingCourse.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editForm.name.trim(),
          color: editForm.color,
          max_drivers: Math.max(1, parseInt(editForm.max_drivers, 10) || 1),
          carrier_id: editForm.carrierId || null,
          carrier: legacyCarrierOf(editForm.carrierId),
          summary_title: editForm.summary_title.trim() ? editForm.summary_title.trim() : null,
          daily_lease: dailyLease,
          principal_invoice_address_id: editForm.principal_invoice_address_id || null,
          counterparty_invoice_address_id: editForm.counterparty_invoice_address_id || null,
          slot_id: editForm.slotId || null,
        }),
      });
      // 単価（course-billing）も保存
      await billingRef.current?.save();
      const updatedCourse: Course = {
        ...editingCourse,
        name: editForm.name.trim(),
        color: editForm.color,
        max_drivers: Math.max(1, parseInt(editForm.max_drivers, 10) || 1),
        carrier: legacyCarrierOf(editForm.carrierId),
        carrier_id: editForm.carrierId || null,
        summary_title: editForm.summary_title.trim() ? editForm.summary_title.trim() : null,
        daily_lease: dailyLease,
        principal_invoice_address_id: editForm.principal_invoice_address_id || null,
        counterparty_invoice_address_id: editForm.counterparty_invoice_address_id || null,
        slot_id: editForm.slotId || null,
      };
      setCourses((prev) => prev.map((c) => (c.id === editingCourse.id ? updatedCourse : c)));
      setShowEditModal(false);
      setEditingCourse(null);
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

  const getDriversForCourse = (courseId: string) => {
    return drivers.filter((d) => driverHasCourse(d, courseId));
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
          setCourses((prev) => prev.filter((c) => c.id !== courseId));
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

  const renderCourseRow = (course: Course, group: { key: string; courses: Course[] }) => {
    const assignedDrivers = getDriversForCourse(course.id);
    const isDragOver = dragOverId === course.id;
    return (
      <div
        key={course.id}
        onClick={() => canWrite && openEditCourse(course)}
        role={canWrite ? "button" : undefined}
        tabIndex={canWrite ? 0 : undefined}
        onKeyDown={(e) => {
          if (canWrite && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openEditCourse(course);
          }
        }}
        onDragOver={(e) => {
          if (!draggingId || !group.courses.some((c) => c.id === draggingId)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOverId(course.id);
        }}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverId(null);
          if (!canWrite || !draggingId) return;
          reorderWithinGroup(group.courses, draggingId, course.id);
          setDraggingId(null);
        }}
        className={`bg-white rounded-lg border border-slate-200 p-4 border-l-4 transition-all ${
          canWrite ? "cursor-pointer hover:border-slate-300 hover:shadow-sm active:bg-slate-50" : ""
        } ${isDragOver ? "ring-2 ring-slate-400 ring-offset-2" : ""}`}
        style={{ borderLeftColor: course.color }}
      >
        <div className="flex items-center justify-between gap-3">
          {canWrite && !reordering && (
            <div
              draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = "move";
                setDraggingId(course.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDragOverId(null);
              }}
              className="shrink-0 -m-2 flex h-11 w-9 items-center justify-center text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none"
              title="ドラッグして並べ替え"
              aria-label="ドラッグして並べ替え"
            >
              <FontAwesomeIcon icon={faGripVertical} className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-slate-900">{course.name}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {assignedDrivers.length > 0 ? (
                assignedDrivers.map((d) => (
                  <span key={d.id} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                    {getDisplayName(d)}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400">担当ドライバー未設定</span>
              )}
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] rounded">
                元請:{" "}
                {course.principal_invoice_address_id
                  ? principalNameById.get(course.principal_invoice_address_id) ?? "未設定"
                  : "未設定"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: course.color }} />
            {canWrite && (
              <span className="hidden sm:inline text-[11px] text-slate-400">編集・単価</span>
            )}
            {canWrite && <FontAwesomeIcon icon={faChevronRight} className="w-3.5 h-3.5 text-slate-300" />}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">コース管理</h1>
          {canWrite && (
            <Button variant="default" size="default" onClick={() => setShowModal(true)}>
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規追加
            </Button>
          )}
        </div>

        <p className="text-sm text-slate-500 mb-4">
          コースはキャリアごとに整理されています。ドライバーとの紐付けは「ユーザー管理」、リース代は各ドライバーの設定で行います。
        </p>

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
        ) : carrierGroups.length === 0 ? (
          <p className="text-sm text-slate-400">コースがまだありません。「新規追加」から作成してください。</p>
        ) : (
          <div className="space-y-6">
            {carrierGroups.map((group) => (
              <section key={group.key}>
                <div className="flex items-center gap-2 mb-2 px-0.5">
                  <FontAwesomeIcon icon={carrierIcon(group.code)} className="w-4 h-4 text-slate-500" />
                  <h2 className="text-sm font-semibold text-slate-700">{group.name}</h2>
                  <span className="text-xs text-slate-400">{group.courses.length}コース</span>
                </div>
                <div className="space-y-2">
                  {group.courses.map((course) => renderCourseRow(course, group))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* 新規コース追加モーダル */}
      {showModal && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">新規コース追加</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {/* 左カラム: 基本情報 */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">キャリア</label>
                  <CustomSelect
                    options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                    value={newCourse.carrierId}
                    onChange={(v) => setNewCourse((f) => ({ ...f, carrierId: v }))}
                    clearable={false}
                    size="sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">時間帯</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "終日（指定なし）" },
                      ...slots.map((s) => ({ value: s.id, label: slotOptionLabel(s) })),
                    ]}
                    value={newCourse.slotId}
                    onChange={(v) => setNewCourse((f) => ({ ...f, slotId: v }))}
                    clearable={false}
                    size="sm"
                  />
                  <p className="mt-1 text-xs text-slate-500">このコースの時間帯（便）。1日に時間帯違いのコースを複数入れられます。時間帯は⚙️設定で作成。</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">コース名</label>
                  <input
                    type="text"
                    value={newCourse.name}
                    onChange={(e) => setNewCourse((f) => ({ ...f, name: e.target.value }))}
                    placeholder="例: 横大路（キャリアは上で選択）"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">キャリアはグループで表示されるため、コース名に「ヤマト」「Amazon」を含める必要はありません。</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">略記（集計・シフト表示用）</label>
                  <input
                    type="text"
                    value={newCourse.summary_title}
                    onChange={(e) => setNewCourse((f) => ({ ...f, summary_title: e.target.value }))}
                    placeholder="例: 横大路、ミッドナイト"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">売上集計タブおよびドライバー側のシフト確認でこの略記が使われます。未入力の場合はコース名を表示します。</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">元請け（請求元）</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "未設定" },
                      ...invoiceAddresses.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    value={newCourse.principal_invoice_address_id}
                    onChange={(v) => setNewCourse((f) => ({ ...f, principal_invoice_address_id: v }))}
                    clearable={false}
                    size="sm"
                    disabled={invoiceAddresses.length === 0}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    請求書作成システムで「請求元」として利用します（アドレス帳に登録済みの法人から選択）。
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">取引先（請求先）</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "未設定" },
                      ...invoiceAddresses.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    value={newCourse.counterparty_invoice_address_id}
                    onChange={(v) => setNewCourse((f) => ({ ...f, counterparty_invoice_address_id: v }))}
                    clearable={false}
                    size="sm"
                    disabled={invoiceAddresses.length === 0}
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

              {/* 右カラム: 日額リース＋単価設定 */}
              <div className="space-y-4 md:border-l md:border-slate-100 md:pl-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">日額リース代（円/稼働日）</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={newCourse.daily_lease}
                    onChange={(e) => setNewCourse((f) => ({ ...f, daily_lease: e.target.value.replace(/\D/g, "") }))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">日額リースのドライバーがこのコースを走った日に、日当から控除し、使用車両の初期費用回収へ自動計上します。</p>
                </div>
                <div className="pt-2 border-t border-slate-100">
                  <CourseRateEditor
                    ref={createBillingRef}
                    courseId={null}
                    carrierId={newCourse.carrierId || null}
                    onError={(msg) => setErrorState({ title: "単価設定", message: msg })}
                  />
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

      {/* コース編集モーダル（横長2カラム・単価設定統合） */}
      {showEditModal && editingCourse && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">コース編集</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {/* 左カラム: 基本情報 */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">キャリア</label>
                  <CustomSelect
                    options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                    value={editForm.carrierId}
                    onChange={(v) => setEditForm((f) => ({ ...f, carrierId: v }))}
                    clearable={false}
                    size="sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">時間帯</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "終日（指定なし）" },
                      ...slots.map((s) => ({ value: s.id, label: slotOptionLabel(s) })),
                    ]}
                    value={editForm.slotId}
                    onChange={(v) => setEditForm((f) => ({ ...f, slotId: v }))}
                    clearable={false}
                    size="sm"
                  />
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">略記（集計・シフト表示用）</label>
                  <input
                    type="text"
                    value={editForm.summary_title}
                    onChange={(e) => setEditForm((f) => ({ ...f, summary_title: e.target.value }))}
                    placeholder="例: 横大路、ミッドナイト"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">未入力の場合はコース名を表示します。</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">元請け（請求元）</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "未設定" },
                      ...invoiceAddresses.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    value={editForm.principal_invoice_address_id}
                    onChange={(v) => setEditForm((f) => ({ ...f, principal_invoice_address_id: v }))}
                    clearable={false}
                    size="sm"
                    disabled={invoiceAddresses.length === 0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">取引先（請求先）</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "未設定" },
                      ...invoiceAddresses.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    value={editForm.counterparty_invoice_address_id}
                    onChange={(v) => setEditForm((f) => ({ ...f, counterparty_invoice_address_id: v }))}
                    clearable={false}
                    size="sm"
                    disabled={invoiceAddresses.length === 0}
                  />
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
              </div>

              {/* 右カラム: 日額リース＋単価設定 */}
              <div className="space-y-4 md:border-l md:border-slate-100 md:pl-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">日額リース代（円/稼働日）</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editForm.daily_lease}
                    onChange={(e) => setEditForm((f) => ({ ...f, daily_lease: e.target.value.replace(/\D/g, "") }))}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">日額リースのドライバーがこのコースを走った日に、日当から控除し、使用車両の初期費用回収へ自動計上します。</p>
                </div>
                <div className="pt-2 border-t border-slate-100">
                  <CourseRateEditor
                    ref={billingRef}
                    courseId={editingCourse.id}
                    onError={(msg) => setErrorState({ title: "単価設定", message: msg })}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-slate-200">
              <button
                onClick={() => {
                  deleteCourse(editingCourse.id, editingCourse.name);
                  setShowEditModal(false);
                  setEditingCourse(null);
                }}
                className="px-4 py-2 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
              >
                削除
              </button>
              <div className="flex gap-2">
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
