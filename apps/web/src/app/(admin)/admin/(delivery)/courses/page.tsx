"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preload } from "swr";
import { swrFetcher } from "@/lib/swr";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faChevronRight,
  faGripVertical,
  faCat,
  faTruck,
  faCheck,
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
import { invalidateApi } from "@/lib/swr";
import { useAutoSave } from "@/lib/useAutoSave";
import { getDisplayName } from "@/lib/displayName";
import { hasCapability } from "@/lib/capabilities";
import { slotDisplayLabel } from "@/lib/timeSlot";
import { Button } from "@/lib/ui/button";
import { TimePicker } from "@/lib/ui/time-picker";

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
  /** A2 時間モデル: 標準の集合場所・集合/着車/終業時刻（NULL=未設定） */
  meeting_place?: string | null;
  meeting_time?: string | null;
  arrival_time?: string | null;
  end_time?: string | null;
};

type TimeSlot = { id: string; name: string; startTime: string | null; endTime: string | null };

/** DB の time 値（"HH:MM:SS"）を input type=time 用の "HH:MM" へ。 */
function toTimeInputValue(v: string | null | undefined): string {
  return v ? v.slice(0, 5) : "";
}
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
  meeting_place: string;
  meeting_time: string;
  arrival_time: string;
  end_time: string;
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
  meeting_place: "",
  meeting_time: "",
  arrival_time: "",
  end_time: "",
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
      void refreshBundle(); // 並べ替えが再訪時に戻らないようキャッシュも確定（待たない）
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
    refresh: refreshBundle,
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
        // 名簿・請求の権限が無いロールでは 403 になる。コース一覧（設定権限）まで
        // 巻き込まず、担当ドライバー・請求先の候補が空になるだけに留める。
        // all=1: ページングなしの全件（既定 limit=20 のままだと21人目以降の
        // 担当表示・割当候補が黙って欠ける）。
        apiFetch<{ drivers: Driver[] }>("/api/admin/users?all=1").catch(() => ({
          drivers: [] as Driver[],
        })),
        apiFetch<{ addresses: InvoiceAddress[] }>("/api/admin/invoice-addresses").catch(() => ({
          addresses: [] as InvoiceAddress[],
        })),
        apiFetch<{ carriers: Carrier[] }>("/api/admin/carriers"),
        apiFetch<{ slots: TimeSlot[] }>("/api/admin/shift-slots").catch(() => ({
          slots: [] as TimeSlot[],
        })),
      ]);
      return {
        courses: coursesRes.courses,
        // API 側が works_as_driver=true で絞るため、role による除外はしない
        drivers: usersRes.drivers,
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
    // 保存中は同期しない（「保存前のサーバー状態」で楽観更新が巻き戻るのを防ぐ・P3）
    if (saveInflightRef.current > 0) return;
    setCourses(bundle.courses);
    setDrivers(bundle.drivers);
    setInvoiceAddresses(bundle.addresses);
    setCarriers(bundle.carriers);
    setSlots(bundle.slots);
  }, [bundle]);

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_courses"));
  }, []);

  // 担当ドライバーの割当（コース作成直後にそのまま担当を決められるようにする・2026-08-03）。
  // 実体はドライバー編集と同じ driver_courses（API: /api/admin/courses/[id]/drivers）。
  const [assignTarget, setAssignTarget] = useState<Course | null>(null);
  const [assignSelected, setAssignSelected] = useState<string[]>([]);
  const [assignQuery, setAssignQuery] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);

  const openAssign = (course: Course) => {
    setAssignTarget(course);
    setAssignSelected(getDriversForCourse(course.id).map((d) => d.id));
    setAssignQuery("");
  };

  // 入力途中でも失わないよう自動保存する。閉じる操作でも必ず保存するので、
  // 「保存を押し忘れて閉じた」で消えることはない（2026-08-06 全画面展開）。
  const persistRef = useRef<(() => Promise<void>) | null>(null);
  const { status: autoSave, flush: flushAutoSave } = useAutoSave({
    value: editForm,
    enabled: showEditModal && !!editingCourse && canWrite && !!editForm.name.trim(),
    resetKey: editingCourse?.id ?? null,
    onSave: async () => {
      await persistRef.current?.();
    },
  });

  // 差分PUT の基準値（モーダルを開いた時点/最後に保存した時点のフォーム値）。
  // users/page.tsx と同型（P1）。変わった項目だけをサーバーへ送る。
  const baselineFormRef = useRef<CourseFormState | null>(null);
  // 二重保存ガード（P3）: closeEditModal が flushAutoSave 直後に persist を再実行しても
  // 同一PUT×2 が並走しない。SWR→state 同期・遅延 refetch も実行中はスキップ/延期する。
  const saveInflightRef = useRef(0);
  const bundleRefreshTimer = useRef<number | null>(null);
  const scheduleBundleRefresh = useCallback(() => {
    if (bundleRefreshTimer.current != null) window.clearTimeout(bundleRefreshTimer.current);
    const tick = () => {
      bundleRefreshTimer.current = null;
      if (saveInflightRef.current > 0) {
        bundleRefreshTimer.current = window.setTimeout(tick, 1500);
        return;
      }
      void refreshBundle();
    };
    bundleRefreshTimer.current = window.setTimeout(tick, 1500);
  }, [refreshBundle]);
  useEffect(() => {
    return () => {
      if (bundleRefreshTimer.current != null) window.clearTimeout(bundleRefreshTimer.current);
    };
  }, []);

  // hover intent 先読み（P8）: 行に 120ms 留まったら単価（course-billing・編集モーダルの
  // CourseRateEditor と同一SWRキー）を裏取得してキャッシュを温める。
  const courseHoverTimerRef = useRef<number | null>(null);
  const prefetchedBillingRef = useRef(new Set<string>());
  const onCourseRowHoverStart = useCallback((cid: string) => {
    if (courseHoverTimerRef.current != null) window.clearTimeout(courseHoverTimerRef.current);
    courseHoverTimerRef.current = window.setTimeout(() => {
      courseHoverTimerRef.current = null;
      const key = `/api/admin/course-billing?course_id=${cid}`;
      if (prefetchedBillingRef.current.has(key)) return;
      prefetchedBillingRef.current.add(key);
      void preload(key, swrFetcher);
    }, 120);
  }, []);
  const onCourseRowHoverEnd = useCallback(() => {
    if (courseHoverTimerRef.current != null) {
      window.clearTimeout(courseHoverTimerRef.current);
      courseHoverTimerRef.current = null;
    }
  }, []);

  const saveAssign = async () => {
    if (!assignTarget) return;
    setAssignSaving(true);
    try {
      await apiFetch(`/api/admin/courses/${assignTarget.id}/drivers`, {
        method: "PUT",
        body: JSON.stringify({ driverIds: assignSelected }),
      });
      setAssignTarget(null);
      await refreshBundle();
      // ドライバー一覧の「担当コース」も変わる。自画面だけ直しても一覧は未設定のまま残る。
      void invalidateApi("/api/admin/users");
    } catch (e) {
      setConfirmState({
        message: e instanceof Error ? e.message : "担当ドライバーの保存に失敗しました",
        onConfirm: () => setConfirmState(null),
      });
    } finally {
      setAssignSaving(false);
    }
  };

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
          meeting_place: newCourse.meeting_place.trim() || null,
          meeting_time: newCourse.meeting_time || null,
          arrival_time: newCourse.arrival_time || null,
          end_time: newCourse.end_time || null,
        }),
      });
      const createdCourse: Course = res.course;
      // 作成直後に、埋め込み単価フォームの内容を新コースID宛に保存。
      await createBillingRef.current?.save(createdCourse.id);
      const nextCourses = [...courses, createdCourse].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setCourses(nextCourses);
      setShowModal(false);
      setNewCourse(EMPTY_COURSE_FORM);
      void refreshBundle();
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
    const form: CourseFormState = {
      name: course.name,
      color: course.color || COLORS[0],
      max_drivers: String(Math.max(1, course.max_drivers ?? 1)),
      carrierId: course.carrier_id ?? "",
      summary_title: course.summary_title ?? "",
      daily_lease: course.daily_lease != null && Number(course.daily_lease) > 0 ? String(course.daily_lease) : "",
      principal_invoice_address_id: course.principal_invoice_address_id ?? "",
      counterparty_invoice_address_id: course.counterparty_invoice_address_id ?? "",
      slotId: course.slot_id ?? "",
      meeting_place: course.meeting_place ?? "",
      meeting_time: toTimeInputValue(course.meeting_time),
      arrival_time: toTimeInputValue(course.arrival_time),
      end_time: toTimeInputValue(course.end_time),
    };
    setEditForm(form);
    baselineFormRef.current = { ...form };
    setShowEditModal(true);
  };

  /**
   * コース編集の保存本体。閉じる操作とは切り離してあり、自動保存からも「保存して閉じる」からも呼ぶ。
   * 単価（course-billing）は別コンポーネントの状態なので、ここで必ず一緒に保存する。
   */
  const persistCourseEdit = async () => {
    if (!canWrite || !editingCourse) return;
    if (!editForm.name.trim()) return;
    // 二重保存ガード: flushAutoSave が発火させた保存の実行中に closeEditModal から
    // 再度呼ばれても、同一内容のPUTを並走させない（P3）
    if (saveInflightRef.current > 0) return;
    saveInflightRef.current += 1;
    setSaving(true);
    try {
      const dailyLease = Math.max(0, parseInt(editForm.daily_lease, 10) || 0);
      // 差分PUT（P1）: 基準値から変わった項目だけ送る。サーバーは undefined の項目を
      // 変更しない部分更新仕様（courses/[id] PUT）。
      const base = baselineFormRef.current;
      const changed = (key: keyof CourseFormState) => !base || base[key] !== editForm[key];
      const payload: Record<string, unknown> = {};
      if (changed("name")) payload.name = editForm.name.trim();
      if (changed("color")) payload.color = editForm.color;
      if (changed("max_drivers")) payload.max_drivers = Math.max(1, parseInt(editForm.max_drivers, 10) || 1);
      if (changed("carrierId")) {
        payload.carrier_id = editForm.carrierId || null;
        payload.carrier = legacyCarrierOf(editForm.carrierId);
      }
      if (changed("summary_title")) payload.summary_title = editForm.summary_title.trim() ? editForm.summary_title.trim() : null;
      if (changed("daily_lease")) payload.daily_lease = dailyLease;
      if (changed("principal_invoice_address_id")) payload.principal_invoice_address_id = editForm.principal_invoice_address_id || null;
      if (changed("counterparty_invoice_address_id")) payload.counterparty_invoice_address_id = editForm.counterparty_invoice_address_id || null;
      if (changed("slotId")) payload.slot_id = editForm.slotId || null;
      if (changed("meeting_place")) payload.meeting_place = editForm.meeting_place.trim() || null;
      if (changed("meeting_time")) payload.meeting_time = editForm.meeting_time || null;
      if (changed("arrival_time")) payload.arrival_time = editForm.arrival_time || null;
      if (changed("end_time")) payload.end_time = editForm.end_time || null;

      // 本体と単価（course-billing・別コンポーネント状態）を並列で保存する（P2）
      const jobs: Promise<unknown>[] = [];
      if (Object.keys(payload).length > 0) {
        jobs.push(
          apiFetch(`/api/admin/courses/${editingCourse.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          }),
        );
      }
      const billingSave = billingRef.current?.save();
      if (billingSave) jobs.push(billingSave);
      await Promise.all(jobs);
      baselineFormRef.current = { ...editForm };
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
        meeting_place: editForm.meeting_place.trim() || null,
        meeting_time: editForm.meeting_time || null,
        arrival_time: editForm.arrival_time || null,
        end_time: editForm.end_time || null,
      };
      setCourses((prev) => prev.map((c) => (c.id === editingCourse.id ? updatedCourse : c)));
      // 5APIの全再取得を毎回待たず、落ち着いてから1回だけ（P3 遅延 refetch）
      scheduleBundleRefresh();
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
      saveInflightRef.current -= 1;
      setSaving(false);
    }
  };

  const getDriversForCourse = (courseId: string) => {
    return drivers.filter((d) => driverHasCourse(d, courseId));
  };

  persistRef.current = persistCourseEdit;

  /** 編集モーダルを閉じる。単価は自動保存の監視外なので、閉じる前に必ず保存する。 */
  const closeEditModal = async () => {
    flushAutoSave();
    await persistCourseEdit();
    setShowEditModal(false);
    setEditingCourse(null);
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
          void refreshBundle(); // 削除したコースが復活しないように
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
        onMouseEnter={() => onCourseRowHoverStart(course.id)}
        onMouseLeave={onCourseRowHoverEnd}
        onTouchStart={() => onCourseRowHoverStart(course.id)}
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
        className={`bg-white rounded-lg border border-slate-200 p-4 border-l-4 transition-all ${canWrite ? "cursor-pointer hover:border-slate-300 hover:shadow-sm active:bg-slate-50" : ""
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
              {canWrite && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openAssign(course);
                  }}
                  className="rounded border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors"
                >
                  担当を選ぶ
                </button>
              )}
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
          コースはキャリアごとに整理されています。担当ドライバーは各行の「担当を選ぶ」から設定できます（ドライバー編集の「担当可能コース」と同じ設定です）。リース代は各ドライバーの設定で行います。
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

      {/* 担当ドライバーの割当モーダル（コース側からの導線） */}
      {assignTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !assignSaving && setAssignTarget(null)}
        >
          <div
            className="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">担当ドライバー</h2>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: assignTarget.color }} />
                {assignTarget.name}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {drivers.length === 0 ? (
                <p className="text-sm text-slate-400">ドライバーを取得できませんでした（名簿の閲覧権限が必要です）。</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={assignQuery}
                    onChange={(e) => setAssignQuery(e.target.value)}
                    placeholder="名前で絞り込み"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {drivers
                      .filter((d) => {
                        const q = assignQuery.trim();
                        if (!q) return true;
                        return `${d.name}${d.display_name ?? ""}`.includes(q);
                      })
                      .map((d) => {
                        const on = assignSelected.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() =>
                              setAssignSelected((prev) =>
                                prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                              )
                            }
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                              on
                                ? "border-slate-800 bg-slate-800 text-white"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {on && <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />}
                            {getDisplayName(d)}
                          </button>
                        );
                      })}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    ドライバー編集の「担当可能コース」と同じ設定です。勤務区分が複数ある人は区分1に紐づきます。
                  </p>
                </>
              )}
            </div>
            <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                disabled={assignSaving}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={saveAssign}
                disabled={assignSaving}
                className="px-4 py-1.5 text-xs font-medium rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {assignSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新規コース追加モーダル */}
      {showModal && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[95vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">新規コース追加</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {/* 列1: 基本情報＋請求関連・人数・色 */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">キャリア</label>
                  <CustomSelect
                    options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                    value={newCourse.carrierId}
                    onChange={(v) => setNewCourse((f) => ({ ...f, carrierId: v }))}
                    clearable={false}
                    size="md"
                  />
                </div>
                {/* 時間に関する設定を1箇所に集約（便区分=分類 / 標準時間=実時刻。役割は別物） */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                  <p className="text-sm font-semibold text-slate-700">時間</p>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">便区分（時間帯）</label>
                    <CustomSelect
                      options={[
                        { value: "", label: "終日（指定なし）" },
                        ...slots.map((s) => ({ value: s.id, label: slotOptionLabel(s) })),
                      ]}
                      value={newCourse.slotId}
                      onChange={(v) => setNewCourse((f) => ({ ...f, slotId: v }))}
                      clearable={false}
                      size="md"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      希望休（便単位）との対応と、シフト表のラベルに使う<b>分類</b>。1日に区分違いのコースを複数入れられます。区分は⚙️設定で作成。
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">標準時間（実際の集合・着車・終業）</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ["meeting_time", "集合"],
                        ["arrival_time", "着車"],
                        ["end_time", "終業"],
                      ] as const).map(([key, label]) => (
                        <div key={key}>
                          <span className="block text-xs text-slate-500 mb-0.5">{label}</span>
                          <TimePicker
                            value={newCourse[key] || null}
                            onChange={(v) => setNewCourse((f) => ({ ...f, [key]: v ?? "" }))}
                            placeholder="--:--"
                            buttonClassName="px-2.5"
                          />
                        </div>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={newCourse.meeting_place}
                      onChange={(e) => setNewCourse((f) => ({ ...f, meeting_place: e.target.value }))}
                      placeholder="集合場所"
                      className="mt-2 w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      このコースの毎日の<b>実時刻</b>。日別の例外はシフト表のセルから個別に上書きできます。
                    </p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">コース名</label>
                  <input
                    type="text"
                    value={newCourse.name}
                    onChange={(e) => setNewCourse((f) => ({ ...f, name: e.target.value }))}
                    placeholder="例: 横大路（キャリアは上で選択）"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">キャリアはグループで表示されるため、コース名に「ヤマト」「Amazon」を含める必要はありません。</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">略記（集計・シフト表示用）</label>
                  <input
                    type="text"
                    value={newCourse.summary_title}
                    onChange={(e) => setNewCourse((f) => ({ ...f, summary_title: e.target.value }))}
                    placeholder="例: 横大路、ミッドナイト"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">売上集計タブおよびドライバー側のシフト確認でこの略記が使われます。未入力の場合はコース名を表示します。</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">取引先（請求先）</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "未設定" },
                      ...invoiceAddresses.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    value={newCourse.counterparty_invoice_address_id}
                    onChange={(v) => setNewCourse((f) => ({ ...f, counterparty_invoice_address_id: v }))}
                    clearable={false}
                    size="md"
                    disabled={invoiceAddresses.length === 0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">1日あたりの最大人数</label>
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
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">色</label>
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

              {/* 列2: 日額リース＋単価設定 */}
              <div className="space-y-4 md:border-l md:border-slate-100 md:pl-6">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">日額リース代（円/稼働日）</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={newCourse.daily_lease}
                    onChange={(e) => setNewCourse((f) => ({ ...f, daily_lease: e.target.value.replace(/\D/g, "") }))}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
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
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => void closeEditModal()}
        >
          <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[95vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">コース編集</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {/* 列1: 基本情報＋請求関連・人数・色 */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">キャリア</label>
                  <CustomSelect
                    options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                    value={editForm.carrierId}
                    onChange={(v) => setEditForm((f) => ({ ...f, carrierId: v }))}
                    clearable={false}
                    size="md"
                  />
                </div>
                {/* 時間に関する設定を1箇所に集約（便区分=分類 / 標準時間=実時刻。役割は別物） */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                  <p className="text-sm font-semibold text-slate-700">時間</p>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">便区分（時間帯）</label>
                    <CustomSelect
                      options={[
                        { value: "", label: "終日（指定なし）" },
                        ...slots.map((s) => ({ value: s.id, label: slotOptionLabel(s) })),
                      ]}
                      value={editForm.slotId}
                      onChange={(v) => setEditForm((f) => ({ ...f, slotId: v }))}
                      clearable={false}
                      size="md"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      希望休（便単位）との対応と、シフト表のラベルに使う<b>分類</b>。区分は⚙️設定で作成。
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">標準時間（実際の集合・着車・終業）</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ["meeting_time", "集合"],
                        ["arrival_time", "着車"],
                        ["end_time", "終業"],
                      ] as const).map(([key, label]) => (
                        <div key={key}>
                          <span className="block text-xs text-slate-500 mb-0.5">{label}</span>
                          <TimePicker
                            value={editForm[key] || null}
                            onChange={(v) => setEditForm((f) => ({ ...f, [key]: v ?? "" }))}
                            placeholder="--:--"
                            buttonClassName="px-2.5"
                          />
                        </div>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={editForm.meeting_place}
                      onChange={(e) => setEditForm((f) => ({ ...f, meeting_place: e.target.value }))}
                      placeholder="集合場所（例: 横大路第2倉庫）"
                      className="mt-2 w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      このコースの毎日の<b>実時刻</b>。日別の例外はシフト表のセルから個別に上書きできます。
                    </p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">コース名</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">略記（集計・シフト表示用）</label>
                  <input
                    type="text"
                    value={editForm.summary_title}
                    onChange={(e) => setEditForm((f) => ({ ...f, summary_title: e.target.value }))}
                    placeholder="例: 横大路、ミッドナイト"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">未入力の場合はコース名を表示します。</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">取引先（請求先）</label>
                  <CustomSelect
                    options={[
                      { value: "", label: "未設定" },
                      ...invoiceAddresses.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    value={editForm.counterparty_invoice_address_id}
                    onChange={(v) => setEditForm((f) => ({ ...f, counterparty_invoice_address_id: v }))}
                    clearable={false}
                    size="md"
                    disabled={invoiceAddresses.length === 0}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">1日あたりの最大人数</label>
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
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">色</label>
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

              {/* 列2: 日額リース＋単価設定 */}
              <div className="space-y-4 md:border-l md:border-slate-100 md:pl-6">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">日額リース代（円/稼働日）</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editForm.daily_lease}
                    onChange={(e) => setEditForm((f) => ({ ...f, daily_lease: e.target.value.replace(/\D/g, "") }))}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
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
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">
                  {saving || autoSave === "saving"
                    ? "保存中…"
                    : autoSave === "saved"
                      ? "自動保存しました"
                      : autoSave === "error"
                        ? "保存に失敗しました"
                        : "変更は自動保存されます"}
                </span>
                <button
                  onClick={() => void closeEditModal()}
                  disabled={saving || !editForm.name.trim()}
                  className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "保存中..." : "保存して閉じる"}
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
