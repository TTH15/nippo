"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { getCompany } from "@/config/companies";
import { hasCapability } from "@/lib/capabilities";
import { computeLicenseLevel } from "@repo/core/logic/license";
import { formatJPPhoneDisplay } from "@repo/core/logic/profile";
import { Button } from "@/lib/ui/button";
import { faTrash, faUser, faPhone, faCircleCheck, faTriangleExclamation, faIdCard, faMoneyBillWave, faBuildingColumns, faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { format } from "date-fns";
import { DatePicker } from "@/lib/components/DatePicker";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

type Course = { id: string; name: string; color: string };
type DriverIdentity = {
  id: string;
  slot: number;
  driver_code: string;
  office_code: string;
  label?: string | null;
  driver_courses: { course_id: string; courses: Course }[];
};
/** DB主キー（UUID）。ドライバーコード・事業所コードが変わっても不変。APIでの特定に使用する */
type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
  role?: string;
  role_id?: string | null;
  /** 顔写真（KYC・identities）の署名URL。一覧アバター用。 */
  faceUrl?: string | null;
  /** 電話番号が Twilio(SMS OTP) 認証済みか（identities.phone_verified_at）。 */
  phone_verified_at?: string | null;
  /** Passkeyを1件以上登録済みか（identities.id経由のpasskey_credentials）。 */
  has_passkey?: boolean;
  company_code?: string;
  office_code: string;
  driver_code: string;
  /** 会社内ドライバー一覧の通し番号（永続） */
  list_no?: number | null;
  created_at?: string;
  license_expiry_date?: string | null;
  status?: string;
  active_from_month?: string | null;
  active_until_month?: string | null;
  postal_code?: string | null;
  address?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  bank_no?: string | null;
  bank_holder?: string | null;
  driver_identities?: DriverIdentity[];
};

type UsersPageResponse = {
  drivers: Driver[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
};

const COMPANY_CODE = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE).code;
const USERS_PAGE_SIZE = 20;

// 口座種別の選択肢
const BANK_TYPES = [
  { value: "普通", label: "普通" },
  { value: "当座", label: "当座" },
  { value: "貯蓄", label: "貯蓄" },
  { value: "その他", label: "その他" },
] as const;

// bank_name を機関名・支店名に分割（"京都信用金庫 梅津支店" → { institution: "京都信用金庫", branch: "梅津支店" }）
function parseBankName(bankName: string): { institution: string; branch: string } {
  const trimmed = (bankName || "").trim();
  if (!trimmed) return { institution: "", branch: "" };
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx < 0) return { institution: trimmed, branch: "" };
  return {
    institution: trimmed.slice(0, spaceIdx),
    branch: trimmed.slice(spaceIdx + 1).trim(),
  };
}

// bank_no を種別・番号に分割（"普通 3058832" → { type: "普通", number: "3058832", typeOther: "" }）
function parseBankNo(bankNo: string): { type: string; number: string; typeOther: string } {
  const trimmed = (bankNo || "").trim();
  if (!trimmed) return { type: "", number: "", typeOther: "" };
  const known = BANK_TYPES.find((t) => t.value !== "その他" && trimmed.startsWith(t.value));
  if (known) {
    const rest = trimmed.slice(known.value.length).trim();
    return { type: known.value, number: rest, typeOther: "" };
  }
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) {
    return { type: "その他", number: trimmed.slice(spaceIdx + 1).trim(), typeOther: trimmed.slice(0, spaceIdx) };
  }
  return { type: "", number: trimmed, typeOther: "" };
}

// 全角→半角変換（数字・ハイフン・括弧など）
function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－−―]/g, "-")
    .replace(/[（）]/g, (c) => (c === "（" ? "(" : ")"))
    .replace(/　/g, " ");
}

/** 一覧用: 全勤務区分のコース（重複除去） */
function allIdentityCourses(d: Driver): { course_id: string; courses: Course }[] {
  const seen = new Set<string>();
  const out: { course_id: string; courses: Course }[] = [];
  for (const idn of d.driver_identities ?? []) {
    for (const dc of idn.driver_courses ?? []) {
      if (seen.has(dc.course_id)) continue;
      seen.add(dc.course_id);
      out.push(dc);
    }
  }
  return out;
}

function sortDrivers(list: Driver[]): Driver[] {
  return [...list].sort((a, b) => {
    const aNo = typeof a.list_no === "number" ? a.list_no : Number.MAX_SAFE_INTEGER;
    const bNo = typeof b.list_no === "number" ? b.list_no : Number.MAX_SAFE_INTEGER;
    if (aNo !== bNo) return aNo - bNo;
    const byName = (a.name || "").localeCompare(b.name || "", "ja");
    if (byName !== 0) return byName;
    return (a.id || "").localeCompare(b.id || "");
  });
}

function currentMonthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type LeaseForm = { enabled: boolean; mode: "MONTHLY" | "DAILY"; amount: string; validFrom: string };
const EMPTY_LEASE: LeaseForm = { enabled: false, mode: "MONTHLY", amount: "", validFrom: currentMonthStartStr() };

export default function UsersPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [openingEditId, setOpeningEditId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalTab, setModalTab] = useState<"basic" | "work" | "contract">("basic");
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  // 詳細モーダルのキャッシュ（同じドライバーを再度開く時はDBを叩かない）
  const detailCache = useRef<Map<string, { driver: Driver; lease: { mode: "MONTHLY" | "DAILY"; amount: number; valid_from: string } | null }>>(new Map());
  // 自動保存（編集モード）。populate 直後の1回はスキップ。
  const skipAutoSave = useRef(true);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // 担当可能コース: 未選択はアコーディオンに隠す（選択中のみ常時表示）
  const [courseOpen1, setCourseOpen1] = useState(false);
  const [courseOpen2, setCourseOpen2] = useState(false);
  const [form, setForm] = useState({
    name: "",
    displayName: "",
    officeCode: "",
    driverNumber: "", // 6桁の数字部分（勤務区分1）
    courseIds: [] as string[],
    officeCode2: "",
    driverNumber2: "",
    courseIds2: [] as string[],
    postalCode: "",
    address: "",
    phone: "",
    bankInstitution: "",
    bankBranch: "",
    bankType: "",
    bankTypeOther: "", // その他選択時の入力値
    bankNumber: "",
    bankHolder: "",
    licenseExpiryDate: "",
    roleId: "", // §2-6 ロール割当（roles.id）。空＝変更しない
    status: "active" as "active" | "inactive",
    activeFromMonth: "", // 'YYYY-MM'。空＝不明
    activeUntilMonth: "", // 'YYYY-MM'。空＝現在も稼働中
  });
  const [leaseForm, setLeaseForm] = useState<LeaseForm>(EMPTY_LEASE);
  const [leaseLoading, setLeaseLoading] = useState(false);
  const [postalLoading, setPostalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [companyCode, setCompanyCode] = useState<string>(COMPANY_CODE);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);

  // 稼働中/稼働終了の切替（既定は稼働中＝従来の一覧挙動）。
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive">("active");

  const usersPageKey = (pageIndex: number, previousPageData: UsersPageResponse | null) => {
    if (previousPageData && !previousPageData.hasMore) return null;
    const cursor = previousPageData?.nextCursor ?? "0";
    return `/api/admin/users?limit=${USERS_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}&status=${statusFilter}`;
  };

  const { data: usersPages, isLoading: usersLoading, isValidating: usersValidating, setSize, mutate: mutateUsers } =
    useSWRInfinite<UsersPageResponse>(usersPageKey, (url: string) => apiFetch<UsersPageResponse>(url), {
      revalidateOnFocus: false,
      dedupingInterval: 10 * 60 * 1000,
      revalidateFirstPage: false,
    });

  const { data: coursesRes, isLoading: coursesLoading } = useSWR<{ courses: Course[] }>(
    "/api/admin/courses",
    (url: string) => apiFetch<{ courses: Course[] }>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30 * 60 * 1000,
    },
  );

  // §2-6 ロール割当用の選択肢（org のロール一覧）。
  const { data: rolesRes } = useSWR<{ roles: { id: string; label: string }[] }>(
    "/api/admin/roles",
    (url: string) => apiFetch<{ roles: { id: string; label: string }[] }>(url),
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 },
  );
  const roleOptions = rolesRes?.roles ?? [];
  const courses = coursesRes?.courses ?? [];

  const hasMore = (usersPages?.[usersPages.length - 1]?.hasMore ?? false) && !usersValidating;
  const loading = usersLoading || coursesLoading;
  const flattenedDrivers = useMemo(
    () => sortDrivers((usersPages ?? []).flatMap((p) => p.drivers ?? [])),
    [usersPages],
  );

  const courseMap = new Map(courses.map((c) => [c.id, c]));

  useEffect(() => {
    const stored = getStoredDriver();
    setCanWrite(hasCapability("can_manage_members"));
    if (stored?.companyCode) {
      setCompanyCode(stored.companyCode);
    }
  }, []);

  // 稼働中/稼働終了タブの切替時は、前のタブのローカルキャッシュ(drivers state)を
  // 引き継がずクリアする（切替直後に別ステータスの一覧が混ざって見えるのを防ぐ）。
  useEffect(() => {
    setDrivers([]);
    void setSize(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // サーバーの取得結果をそのまま採用する。
  // 以前はローカル優先でマージ（prevById.get(d.id) ?? d）していたが、
  //   ・サーバー側の更新（他の管理者の変更）が永久に反映されない
  //   ・ローカルにしか無い行を復活させるため、削除したドライバーが戻る
  // という不具合になっていた。楽観更新は書き込み直後の一瞬だけ効けばよく、
  // 確定は各書き込み後の mutateUsers() が担う。
  useEffect(() => {
    setDrivers((prev) => {
      if (flattenedDrivers.length === 0 && prev.length === 0) return prev;
      return flattenedDrivers;
    });
  }, [flattenedDrivers]);

  // 運営のドライバー一覧は件数が限定的なので、hasMore の間は全ページを自動取得する。
  // （無限スクロール待ちで末尾のドライバーが表示されない問題を回避）
  useEffect(() => {
    if (hasMore) void setSize((s) => s + 1);
  }, [hasMore, setSize]);

  const openNew = () => {
    if (!canWrite) return;
    setEditingDriver(null);
    setForm({
      name: "",
      displayName: "",
      officeCode: "",
      driverNumber: "",
      courseIds: [],
      officeCode2: "",
      driverNumber2: "",
      courseIds2: [],
      postalCode: "",
      address: "",
      phone: "",
      bankInstitution: "",
      bankBranch: "",
      bankType: "",
      bankTypeOther: "",
      bankNumber: "",
      bankHolder: "",
      licenseExpiryDate: "",
      roleId: "",
      status: "active",
      activeFromMonth: "",
      activeUntilMonth: "",
    });
    setLeaseForm({ ...EMPTY_LEASE, validFrom: currentMonthStartStr() });
    setShowModal(true);
  };

  // 取得済みドライバー詳細＋リースから編集フォームを埋める（fetch/キャッシュ共通）
  const populateForm = (
    full: Driver,
    lease: { mode: "MONTHLY" | "DAILY"; amount: number; valid_from: string } | null,
  ) => {
    setLeaseForm(
      lease
        ? {
            enabled: true,
            mode: lease.mode === "DAILY" ? "DAILY" : "MONTHLY",
            amount: String(lease.amount ?? ""),
            validFrom:
              lease.valid_from && /^\d{4}-\d{2}-\d{2}$/.test(lease.valid_from)
                ? lease.valid_from
                : currentMonthStartStr(),
          }
        : { ...EMPTY_LEASE, validFrom: currentMonthStartStr() },
    );
    setEditingDriver(full);
    const { institution, branch } = parseBankName(full.bank_name || "");
    const { type, number, typeOther } = parseBankNo(full.bank_no || "");
    const id1 = full.driver_identities?.find((x) => x.slot === 1);
    const id2 = full.driver_identities?.find((x) => x.slot === 2);
    setForm({
      name: full.name,
      displayName: full.display_name?.trim() ?? getDisplayName(full),
      officeCode: id1?.office_code ?? full.office_code ?? "",
      driverNumber: (id1?.driver_code ?? full.driver_code)?.slice(3) || "",
      courseIds: (id1?.driver_courses ?? []).map((dc) => dc.course_id),
      officeCode2: id2?.office_code ?? "",
      driverNumber2: id2?.driver_code?.slice(3) ?? "",
      courseIds2: (id2?.driver_courses ?? []).map((dc) => dc.course_id),
      postalCode: full.postal_code || "",
      address: full.address || "",
      phone: full.phone || "",
      bankInstitution: institution,
      bankBranch: branch,
      bankType: type,
      bankTypeOther: typeOther,
      bankNumber: number,
      bankHolder: full.bank_holder || "",
      licenseExpiryDate:
        full.license_expiry_date && /^\d{4}-\d{2}-\d{2}$/.test(full.license_expiry_date)
          ? full.license_expiry_date
          : "",
      roleId: full.role_id ?? "",
      status: full.status === "inactive" ? "inactive" : "active",
      activeFromMonth:
        full.active_from_month && /^\d{4}-\d{2}$/.test(full.active_from_month) ? full.active_from_month : "",
      activeUntilMonth:
        full.active_until_month && /^\d{4}-\d{2}$/.test(full.active_until_month) ? full.active_until_month : "",
    });
  };

  const openEdit = async (d: Driver) => {
    if (!canWrite) return;
    skipAutoSave.current = true; // populate では自動保存しない
    setAutoSaveStatus("idle");
    setModalTab("basic");
    setEditingDriver(d);

    // キャッシュヒット: DBを叩かず即時表示
    const cached = detailCache.current.get(d.id);
    if (cached) {
      setModalLoading(false);
      setLeaseLoading(false);
      setShowModal(true);
      populateForm(cached.driver, cached.lease);
      return;
    }

    // キャッシュミス: スケルトンを即時表示しつつ取得
    setModalLoading(true);
    setShowModal(true);
    setOpeningEditId(d.id);
    setLeaseLoading(true);
    try {
      const [res, leaseRes] = await Promise.all([
        apiFetch<{ driver: Driver }>(`/api/admin/users/${d.id}`),
        apiFetch<{ lease: { mode: "MONTHLY" | "DAILY"; amount: number; valid_from: string } | null }>(
          `/api/admin/driver-lease?driver_id=${encodeURIComponent(d.id)}`,
        ).catch(() => ({ lease: null })),
      ]);
      const full = res.driver;
      const lease = leaseRes.lease;
      detailCache.current.set(d.id, { driver: full, lease });
      skipAutoSave.current = true; // 取得後の populate でも自動保存しない
      populateForm(full, lease);
    } catch (e) {
      console.error(e);
      setShowModal(false);
      setErrorState({
        title: "ドライバー詳細の取得に失敗しました",
        message: "編集用データの取得に失敗しました。時間をおいて再度お試しください。",
      });
    } finally {
      setOpeningEditId(null);
      setLeaseLoading(false);
      setModalLoading(false);
    }
  };

  const getBankTypeForSave = () => {
    if (form.bankType === "その他") return form.bankTypeOther.trim() || "その他";
    return form.bankType;
  };

  const fetchAddressFromPostalCode = async (zipOverride?: string) => {
    const raw = zipOverride ?? form.postalCode;
    const zip = toHalfWidth(raw).replace(/-/g, "").replace(/\D/g, "");
    if (zip.length < 7) {
      setErrorState({
        title: "郵便番号の桁数が足りません",
        message:
          "郵便番号が7桁未満のため、住所を検索できませんでした。\n\n" +
          "「1234567」または「123-4567」の形式で7桁の郵便番号を入力してから、再度「住所検索」ボタンを押してください。",
      });
      return;
    }
    setPostalLoading(true);
    try {
      const res = await fetch(
        `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`
      );
      const data = await res.json();
      if (data.status === 200 && data.results?.[0]) {
        const r = data.results[0];
        const addr = [r.address1, r.address2, r.address3].filter(Boolean).join("");
        setForm((f) => ({ ...f, address: addr }));
      } else {
        setErrorState({
          title: "住所が見つかりませんでした",
          message:
            "入力された郵便番号に該当する住所が見つかりませんでした。\n\n" +
            "郵便番号に誤りがないか確認し、それでも見つからない場合は、住所欄に直接入力してください。",
        });
      }
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "住所の取得に失敗しました",
        message:
          "外部の住所検索サービスへのアクセス中にエラーが発生しました。\n\n" +
          "一時的な通信エラーの可能性がありますので、時間をおいて再度お試しください。",
        detail: reason || undefined,
      });
    } finally {
      setPostalLoading(false);
    }
  };

  const toggleCourse = (cid: string) => {
    setForm((f) => ({
      ...f,
      courseIds: f.courseIds.includes(cid)
        ? f.courseIds.filter((id) => id !== cid)
        : [...f.courseIds, cid],
    }));
  };

  const toggleCourse2 = (cid: string) => {
    setForm((f) => ({
      ...f,
      courseIds2: f.courseIds2.includes(cid)
        ? f.courseIds2.filter((id) => id !== cid)
        : [...f.courseIds2, cid],
    }));
  };

  const save = async (opts?: { silent?: boolean }) => {
    if (!canWrite) return;
    const silent = opts?.silent === true;
    setSaving(true);
    try {
      const driverCode = companyCode + form.driverNumber;
      const makeIdentity = (slot: 1 | 2) => {
        const office = slot === 1 ? form.officeCode : form.officeCode2;
        const number = slot === 1 ? form.driverNumber : form.driverNumber2;
        const courseIds = slot === 1 ? form.courseIds : form.courseIds2;
        if (!office || !number || !/^\d{6}$/.test(office) || !/^\d{6}$/.test(number)) return null;
        const full = `${companyCode}${number}`;
        return {
          id: `local-${slot}`,
          slot,
          driver_code: full,
          office_code: office,
          label: null,
          driver_courses: courseIds
            .map((courseId) => {
              const course = courseMap.get(courseId);
              return course ? { course_id: courseId, courses: course } : null;
            })
            .filter((v): v is { course_id: string; courses: Course } => v !== null),
        };
      };

      const slot1Identity = makeIdentity(1);
      const slot2Identity = makeIdentity(2);
      const nextIdentities = [slot1Identity, slot2Identity].filter(
        (v): v is NonNullable<typeof v> => v !== null,
      );

      let savedDriverId = editingDriver?.id ?? "";
      if (editingDriver) {
        await apiFetch(`/api/admin/users/${editingDriver.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name,
            displayName: form.displayName.trim() || null,
            identities: [
              {
                slot: 1,
                officeCode: form.officeCode,
                driverNumber: form.driverNumber,
                courseIds: form.courseIds,
              },
              {
                slot: 2,
                officeCode: form.officeCode2,
                driverNumber: form.driverNumber2,
                courseIds: form.courseIds2,
              },
            ],
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            bankName: [form.bankInstitution, form.bankBranch].filter(Boolean).join(" ") || null,
            bankNo: [getBankTypeForSave(), form.bankNumber].filter(Boolean).join(" ") || null,
            bankHolder: form.bankHolder.trim() || null,
            licenseExpiryDate: form.licenseExpiryDate.trim() || null,
            roleId: form.roleId || null,
            status: form.status,
            activeFromMonth: form.activeFromMonth || null,
            activeUntilMonth: form.activeUntilMonth || null,
          }),
        });
        setDrivers((prev) =>
          sortDrivers(
            prev.map((d) =>
              d.id === editingDriver.id
                ? {
                    ...d,
                    name: form.name.trim(),
                    display_name: form.displayName.trim() || null,
                    office_code: form.officeCode,
                    driver_code: driverCode,
                    postal_code: form.postalCode.trim() || null,
                    address: form.address.trim() || null,
                    phone: form.phone.trim() || null,
                    bank_name: [form.bankInstitution, form.bankBranch].filter(Boolean).join(" ") || null,
                    bank_no: [getBankTypeForSave(), form.bankNumber].filter(Boolean).join(" ") || null,
                    bank_holder: form.bankHolder.trim() || null,
                    license_expiry_date: form.licenseExpiryDate.trim() || null,
                    status: form.status,
                    active_from_month: form.activeFromMonth || null,
                    active_until_month: form.activeUntilMonth || null,
                    driver_identities: nextIdentities,
                  }
                : d,
            ),
          ),
        );
      } else {
        const created = await apiFetch<{ driver: Driver }>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            displayName: form.displayName.trim() || null,
            officeCode: form.officeCode,
            driverCode,
            companyCode,
            courseIds: form.courseIds,
            officeCode2: slot2Started ? form.officeCode2 : undefined,
            driverNumber2: slot2Started ? form.driverNumber2 : undefined,
            courseIds2: slot2Started ? form.courseIds2 : undefined,
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            bankName: [form.bankInstitution, form.bankBranch].filter(Boolean).join(" ") || null,
            bankNo: [getBankTypeForSave(), form.bankNumber].filter(Boolean).join(" ") || null,
            bankHolder: form.bankHolder.trim() || null,
            licenseExpiryDate: form.licenseExpiryDate.trim() || null,
          }),
        });
        const newDriver: Driver = {
          ...created.driver,
          name: form.name.trim(),
          display_name: form.displayName.trim() || null,
          role: "DRIVER",
          company_code: companyCode,
          office_code: form.officeCode,
          driver_code: driverCode,
          postal_code: form.postalCode.trim() || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          bank_name: [form.bankInstitution, form.bankBranch].filter(Boolean).join(" ") || null,
          bank_no: [getBankTypeForSave(), form.bankNumber].filter(Boolean).join(" ") || null,
          bank_holder: form.bankHolder.trim() || null,
          license_expiry_date: form.licenseExpiryDate.trim() || null,
          driver_identities: nextIdentities,
        };
        setDrivers((prev) => sortDrivers([...prev, newDriver]));
        savedDriverId = created.driver.id;
      }

      // リース設定（専用概念）。enabled=false / 金額0 で解除。
      if (savedDriverId) {
        try {
          await apiFetch("/api/admin/driver-lease", {
            method: "PUT",
            body: JSON.stringify({
              driver_id: savedDriverId,
              enabled: leaseForm.enabled,
              mode: leaseForm.mode,
              amount: leaseForm.enabled ? parseInt(leaseForm.amount, 10) || 0 : 0,
              valid_from: leaseForm.validFrom || currentMonthStartStr(),
            }),
          });
        } catch (leaseErr) {
          console.error("[users] lease save error", leaseErr);
        }
      }

      // 保存後はキャッシュを無効化（次回オープン時に最新を1回だけ取得）
      if (savedDriverId) detailCache.current.delete(savedDriverId);
      if (silent) {
        setAutoSaveStatus("saved");
      } else {
        setShowModal(false);
      }
      // 一覧の SWR キャッシュも最新化する（dedupingInterval が10分あるため、
      // これを怠ると再訪時に古い一覧で上書きされ「保存されていない」ように見える）。
      // 保存自体は確定済みなので待たない。
      void mutateUsers();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      if (silent) {
        setAutoSaveStatus("error");
      } else {
        setErrorState({
          title: "ドライバー情報の保存に失敗しました",
          message:
            "サーバーでエラーが発生したため、ドライバー情報を保存できませんでした。\n\n" +
            "入力内容（コードの重複や必須項目の抜けなど）を確認し、もう一度保存してください。\n" +
            "同じエラーが続く場合は、システム管理者に連絡してください。",
          detail: reason || undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteDriver = async (id: string, name: string) => {
    if (!canWrite) return;
    setConfirmState({
      message: `${name}を削除しますか？`,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
          setDrivers((prev) => prev.filter((d) => d.id !== id));
          setShowModal(false);
          void mutateUsers(); // 削除したドライバーが再訪時に復活しないように
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "ドライバーの削除に失敗しました",
            message:
              "サーバーでエラーが発生したため、このドライバーを削除できませんでした。\n\n" +
              "このドライバーに紐付いたシフトや日報が原因の可能性があります。時間をおいて再度お試しいただくか、システム管理者に連絡してください。",
            detail: reason || undefined,
          });
        }
      },
    });
  };

  const unlinkPhone = async (id: string) => {
    if (!canWrite) return;
    setConfirmState({
      message:
        "電話番号の確認状態を解除しますか？解除後、ドライバー本人がマイページから番号を確認し直せるようになります。",
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/users/${id}/phone`, { method: "DELETE" });
          setEditingDriver((prev) => (prev ? { ...prev, phone_verified_at: null } : prev));
          setForm((f) => ({ ...f, phone: "" }));
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "電話番号の削除に失敗しました",
            message: "サーバーでエラーが発生したため、電話番号を削除できませんでした。",
            detail: reason || undefined,
          });
        }
      },
    });
  };

  const slot2Started =
    form.officeCode2.trim().length > 0 ||
    form.driverNumber2.trim().length > 0 ||
    form.courseIds2.length > 0;
  const slot2Valid =
    !slot2Started ||
    (form.officeCode2.length === 6 &&
      /^\d{6}$/.test(form.officeCode2) &&
      form.driverNumber2.length === 6 &&
      /^\d{6}$/.test(form.driverNumber2));

  const isFormValid =
    !!form.name.trim() &&
    form.officeCode.length === 6 &&
    /^\d{6}$/.test(form.officeCode) &&
    form.driverNumber.length === 6 &&
    /^\d{6}$/.test(form.driverNumber) &&
    slot2Valid;

  // 判定しきい値はメニューバッジ（更新が迫っている人数）と共有するため core/logic/license に集約。
  // インライン権限変更（この画面から role を変更。can_manage_members 必須＝canWrite）。
  // 楽観更新→失敗時ロールバック。最後の管理者保護等はサーバ(PUT)が弾く。
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const roleLabelOf = (d: Driver) =>
    roleOptions.find((r) => r.id === d.role_id)?.label ?? d.role ?? "—";
  const changeRole = async (d: Driver, roleId: string) => {
    if (!roleId || roleId === d.role_id) return;
    const prevRoleId = d.role_id ?? null;
    setRoleSavingId(d.id);
    setDrivers((list) => list.map((x) => (x.id === d.id ? { ...x, role_id: roleId } : x)));
    try {
      await apiFetch(`/api/admin/users/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({ roleId }),
      });
      void mutateUsers(); // 権限変更が再訪時に元へ戻らないように
    } catch (e) {
      setDrivers((list) => list.map((x) => (x.id === d.id ? { ...x, role_id: prevRoleId } : x)));
      setErrorState({
        title: "権限の変更に失敗しました",
        message: e instanceof Error ? e.message : "権限を変更できませんでした。",
      });
    } finally {
      setRoleSavingId(null);
    }
  };

  // 免許期限を「YYYY年MM月DD日」で表示（ハイフン禁止／年月日は小さく薄く）。
  const jpDate = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return <>{iso}</>;
    const u = "text-[10px] font-normal opacity-60 mx-0.5";
    return (
      <>
        {m[1]}<span className={u}>年</span>{m[2]}<span className={u}>月</span>{m[3]}<span className={u}>日</span>
      </>
    );
  };

  const getLicenseStatus = (dateStr?: string | null): { label: string; className: string } => {
    switch (computeLicenseLevel(dateStr)) {
      case "unset":
        return { label: "未設定", className: "bg-slate-100 text-slate-500" };
      case "expired":
        return { label: `${dateStr}（期限切れ）`, className: "bg-red-100 text-red-700" };
      case "within1Month":
        return { label: `${dateStr}（1ヶ月以内）`, className: "bg-red-100 text-red-700" };
      case "within2Months":
        return { label: `${dateStr}（2ヶ月以内）`, className: "bg-amber-100 text-amber-700" };
      default:
        return { label: dateStr ?? "", className: "bg-emerald-100 text-emerald-700" };
    }
  };

  // 自動保存（編集モード）: 入力変更を1秒デバウンスで PUT。populate直後・無効入力・新規はスキップ。
  // showModal は依存に含めない: モーダルを閉じても保留中の保存タイマーを打ち切らず、
  // バックグラウンドで完了させるため（閉じた直後の変更が保存されずに消えるのを防ぐ）。
  useEffect(() => {
    if (modalLoading || !editingDriver || !canWrite || !isFormValid) return;
    if (!showModal) return; // モーダルが開いている間の変更だけを新規にスケジュールする
    if (skipAutoSave.current) {
      skipAutoSave.current = false;
      return;
    }
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setAutoSaveStatus("saving");
    autoSaveTimer.current = setTimeout(() => {
      void save({ silent: true });
    }, 1000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, leaseForm, modalLoading, editingDriver, isFormValid]);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">ドライバー管理</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              会社コード: {companyCode}
              <span className="hidden md:inline text-slate-400"> · 並び順: No.（昇順）、同値時は名前順</span>
            </p>
          </div>
          {canWrite && (
            <Button variant="default" size="default" onClick={openNew}>
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規追加
            </Button>
          )}
        </div>

        <div className="inline-flex gap-1 bg-slate-100 p-1 rounded-lg mb-4">
          {(
            [
              { key: "active" as const, label: "稼働中" },
              { key: "inactive" as const, label: "稼働終了" },
            ]
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setStatusFilter(o.key)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                statusFilter === o.key ? "bg-white text-slate-900 shadow-sm font-medium" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : drivers.length === 0 ? (
          <p className="text-sm text-slate-500">ドライバーが登録されていません</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {/* スマホ: カード一覧（横スクロール不要で全情報＋権限変更まで完結） */}
            <div className="md:hidden divide-y divide-slate-100">
              {drivers.map((d, index) => {
                const coursesOfDriver = allIdentityCourses(d);
                const licenseStatus = getLicenseStatus(d.license_expiry_date);
                return (
                  <div
                    key={d.id}
                    onClick={() => canWrite && void openEdit(d)}
                    className={`px-4 py-3 ${canWrite ? "cursor-pointer active:bg-slate-50" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      {d.faceUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.faceUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-400 shrink-0">
                          <FontAwesomeIcon icon={faUser} className="w-4 h-4" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2 min-w-0">
                          <span className="shrink-0 text-xs text-slate-400 tabular-nums">#{d.list_no ?? index + 1}</span>
                          <span className="truncate font-semibold text-slate-900">{d.name}</span>
                          {getDisplayName(d) !== d.name && (
                            <span className="truncate text-xs text-slate-500">{getDisplayName(d)}</span>
                          )}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {coursesOfDriver.slice(0, 2).map((dc) => (
                            <span
                              key={dc.course_id}
                              className="max-w-[110px] truncate whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-white"
                              style={{ backgroundColor: dc.courses.color }}
                              title={dc.courses.name}
                            >
                              {dc.courses.name}
                            </span>
                          ))}
                          {coursesOfDriver.length > 2 && (
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                              +{coursesOfDriver.length - 2}
                            </span>
                          )}
                          {coursesOfDriver.length === 0 && (
                            <span className="text-[11px] text-slate-400">コース未設定</span>
                          )}
                          {d.license_expiry_date ? (
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${licenseStatus.className}`}>
                              免許 {jpDate(d.license_expiry_date)}
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">免許未設定</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {canWrite ? (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={d.role_id ?? ""}
                          disabled={roleSavingId === d.id}
                          onChange={(e) => changeRole(d, e.target.value)}
                          className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100 disabled:opacity-50"
                        >
                          {!d.role_id && <option value="">権限: 未設定</option>}
                          {roleOptions.map((r) => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs text-slate-600">権限: {roleLabelOf(d)}</p>
                    )}
                  </div>
                );
              })}
            </div>
            {/* PC: 既存テーブル */}
            <div className="hidden md:block overflow-x-auto table-scroll table-scroll-fade">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold w-12">No.</th>
                    <th className="px-4 py-3 text-left font-semibold">ドライバー</th>
                    <th className="px-4 py-3 text-left font-semibold">表示名</th>
                    <th className="px-4 py-3 text-left font-semibold">コース</th>
                    <th className="px-4 py-3 text-left font-semibold">免許期限</th>
                    <th className="px-4 py-3 text-left font-semibold w-44">権限</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d, index) => {
                    const coursesOfDriver = allIdentityCourses(d);
                    const licenseStatus = getLicenseStatus(d.license_expiry_date);
                    return (
                      <tr
                        key={d.id}
                        onClick={() => canWrite && void openEdit(d)}
                        className={`border-t border-slate-100 ${canWrite ? "cursor-pointer hover:bg-slate-50" : ""}`}
                      >
                        <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">{d.list_no ?? index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            {d.faceUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={d.faceUrl} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0" />
                            ) : (
                              <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-slate-100 text-slate-400 shrink-0">
                                <FontAwesomeIcon icon={faUser} className="w-4 h-4" />
                              </span>
                            )}
                            <span className="font-semibold text-slate-900 whitespace-nowrap">{d.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{getDisplayName(d)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 max-w-[230px] overflow-hidden">
                            {coursesOfDriver.slice(0, 2).map((dc) => (
                              <span
                                key={dc.course_id}
                                className="px-2 py-1 rounded text-xs text-white whitespace-nowrap truncate max-w-[100px]"
                                style={{ backgroundColor: dc.courses.color }}
                                title={dc.courses.name}
                              >
                                {dc.courses.name}
                              </span>
                            ))}
                            {coursesOfDriver.length > 2 && (
                              <span className="px-2 py-1 rounded text-xs bg-slate-100 text-slate-500 whitespace-nowrap shrink-0">
                                +{coursesOfDriver.length - 2}
                              </span>
                            )}
                            {coursesOfDriver.length === 0 && <span className="text-xs text-slate-400">未設定</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {d.license_expiry_date ? (
                            <span className={`inline-flex items-baseline px-2.5 py-1 rounded text-sm font-semibold whitespace-nowrap ${licenseStatus.className}`}>
                              {jpDate(d.license_expiry_date)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold bg-slate-100 text-slate-500">未設定</span>
                          )}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {canWrite ? (
                            <select
                              value={d.role_id ?? ""}
                              disabled={roleSavingId === d.id}
                              onChange={(e) => changeRole(d, e.target.value)}
                              className="w-full max-w-[170px] appearance-none rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100 disabled:opacity-50"
                            >
                              {!d.role_id && <option value="">未設定</option>}
                              {roleOptions.map((r) => (
                                <option key={r.id} value={r.id}>{r.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-slate-600">{roleLabelOf(d)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {usersValidating && (
              <div className="text-center text-xs text-slate-500 py-3">読み込み中...</div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && canWrite && (
        <div className="modal-backdrop-in fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="modal-panel-in bg-white rounded-lg shadow-lg w-full max-w-2xl h-[85vh] flex flex-col p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingDriver
                ? `No.${editingDriver.list_no ?? "—"}　${editingDriver.name}`
                : "新規ドライバー追加"}
            </h2>

            <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1">
            {modalLoading ? (
              <div className="space-y-4">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : (
            <>
            <div className="flex gap-1 border-b border-slate-200 mb-4">
              {([["basic", "基本"], ["work", "勤務"], ["contract", "契約"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setModalTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${modalTab === key ? "border-amber-500 text-amber-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="space-y-4">
              {modalTab === "basic" && (
              <>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2">
                <FontAwesomeIcon icon={faUser} className="w-3.5 h-3.5 text-slate-400" />
                基本情報
              </div>
              {!editingDriver && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">名前</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">表示名</label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder="未入力なら苗字のみ"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                {editingDriver && roleOptions.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">ロール・権限</label>
                    <select
                      value={form.roleId}
                      onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      <option value="">（変更しない）</option>
                      {roleOptions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              </>
              )}

              {modalTab === "work" && (
              <>
              <p className="text-xs font-semibold text-slate-600 pt-1">勤務区分1</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">事業所コード（6桁）</label>
                <input
                  type="text"
                  maxLength={6}
                  value={form.officeCode}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm((f) => ({ ...f, officeCode: v }));
                  }}
                  placeholder="000001"
                  className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
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
                    className="flex-1 px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  この6桁が初回ログイン時のPINになります
                </p>
              </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-400">担当可能コース（区分1）</label>
                  <button
                    type="button"
                    onClick={() => setCourseOpen1((o) => !o)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors"
                  >
                    <FontAwesomeIcon icon={courseOpen1 ? faChevronUp : faChevronDown} className="w-2.5 h-2.5" />
                    {courseOpen1 ? "閉じる" : "コースを選択"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {courses.filter((c) => form.courseIds.includes(c.id)).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCourse(c.id)}
                      className="px-3 py-1.5 rounded text-sm font-medium text-white border border-transparent transition-transform active:scale-95"
                      style={{ backgroundColor: c.color }}
                    >
                      {c.name}
                    </button>
                  ))}
                  {form.courseIds.length === 0 && <span className="text-xs text-slate-400 py-1.5">未選択</span>}
                </div>
                <div className={`grid transition-all duration-300 ease-out ${courseOpen1 ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="overflow-hidden">
                    <div className="flex flex-wrap gap-2 pt-1">
                      {courses.filter((c) => !form.courseIds.includes(c.id)).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCourse(c.id)}
                          className="px-3 py-1.5 rounded text-sm font-medium border text-slate-600 border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                        >
                          {c.name}
                        </button>
                      ))}
                      {courses.filter((c) => !form.courseIds.includes(c.id)).length === 0 && (
                        <span className="text-xs text-slate-400 py-1.5">追加できるコースはありません</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-600 mb-2">勤務区分2（任意）</p>
                <p className="text-xs text-slate-500 mb-3">
                  別コード・別事業所で日報を分ける場合。未入力のままなら区分2は無効です。
                </p>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">事業所コード（6桁）</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={form.officeCode2}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "");
                        setForm((f) => ({ ...f, officeCode2: v }));
                      }}
                      placeholder="000000"
                      className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">ドライバーコード</label>
                    <div className="flex items-center gap-1">
                      <span className="px-3 py-2 bg-slate-100 border border-slate-200 rounded text-sm font-mono text-slate-600">
                        {companyCode}
                      </span>
                      <input
                        type="text"
                        maxLength={6}
                        value={form.driverNumber2}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "");
                          setForm((f) => ({ ...f, driverNumber2: v }));
                        }}
                        placeholder="123456"
                        className="flex-1 px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                  </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-slate-400">担当可能コース（区分2）</label>
                      <button
                        type="button"
                        onClick={() => setCourseOpen2((o) => !o)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors"
                      >
                        <FontAwesomeIcon icon={courseOpen2 ? faChevronUp : faChevronDown} className="w-2.5 h-2.5" />
                        {courseOpen2 ? "閉じる" : "コースを選択"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {courses.filter((c) => form.courseIds2.includes(c.id)).map((c) => (
                        <button
                          key={`s2-sel-${c.id}`}
                          type="button"
                          onClick={() => toggleCourse2(c.id)}
                          className="px-3 py-1.5 rounded text-sm font-medium text-white border border-transparent transition-transform active:scale-95"
                          style={{ backgroundColor: c.color }}
                        >
                          {c.name}
                        </button>
                      ))}
                      {form.courseIds2.length === 0 && <span className="text-xs text-slate-400 py-1.5">未選択</span>}
                    </div>
                    <div className={`grid transition-all duration-300 ease-out ${courseOpen2 ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"}`}>
                      <div className="overflow-hidden">
                        <div className="flex flex-wrap gap-2 pt-1">
                          {courses.filter((c) => !form.courseIds2.includes(c.id)).map((c) => (
                            <button
                              key={`s2-unsel-${c.id}`}
                              type="button"
                              onClick={() => toggleCourse2(c.id)}
                              className="px-3 py-1.5 rounded text-sm font-medium border text-slate-600 border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                            >
                              {c.name}
                            </button>
                          ))}
                          {courses.filter((c) => !form.courseIds2.includes(c.id)).length === 0 && (
                            <span className="text-xs text-slate-400 py-1.5">追加できるコースはありません</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </>
              )}

              {modalTab === "contract" && (
              <>
              <div className="pt-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1">
                  <FontAwesomeIcon icon={faCircleCheck} className="w-3.5 h-3.5 text-slate-400" />
                  稼働状況
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  「稼働終了」にすると通常の一覧・ピッカーには出てこなくなります。過去の請求書一覧では、稼働開始月〜終了月の期間に該当すれば引き続き表示されます。
                </p>
                <div className="flex gap-2 mb-3">
                  {(
                    [
                      { key: "active" as const, label: "稼働中" },
                      { key: "inactive" as const, label: "稼働終了" },
                    ]
                  ).map((o) => {
                    const active = form.status === o.key;
                    const hasCourses = form.courseIds.length > 0 || form.courseIds2.length > 0;
                    const disabled = o.key === "inactive" && form.status !== "inactive" && hasCourses;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        disabled={disabled}
                        onClick={() => setForm((f) => ({ ...f, status: o.key }))}
                        title={disabled ? "先に担当コースの割り当てをすべて解除してください" : undefined}
                        className={`px-4 py-1.5 rounded text-sm font-medium border transition-colors ${
                          active
                            ? "bg-slate-800 text-white border-slate-800"
                            : disabled
                              ? "text-slate-300 border-slate-100 bg-slate-50 cursor-not-allowed"
                              : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                {form.status === "inactive" && (form.courseIds.length > 0 || form.courseIds2.length > 0) && (
                  <p className="text-xs text-amber-600 mb-3">
                    <FontAwesomeIcon icon={faTriangleExclamation} className="w-3 h-3 mr-1" />
                    担当コースが割り当てられたままです。保存前に「基本情報」タブでコースの割り当てをすべて解除してください。
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">稼働開始月</label>
                    <MonthYearPicker
                      value={
                        form.activeFromMonth && /^\d{4}-\d{2}$/.test(form.activeFromMonth)
                          ? { year: Number(form.activeFromMonth.slice(0, 4)), month: Number(form.activeFromMonth.slice(5, 7)) }
                          : undefined
                      }
                      onChange={({ year, month }) =>
                        setForm((f) => ({ ...f, activeFromMonth: `${year}-${String(month).padStart(2, "0")}` }))
                      }
                      placeholder="不明"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">稼働終了月</label>
                    <div className="flex items-center gap-2">
                      <MonthYearPicker
                        value={
                          form.activeUntilMonth && /^\d{4}-\d{2}$/.test(form.activeUntilMonth)
                            ? { year: Number(form.activeUntilMonth.slice(0, 4)), month: Number(form.activeUntilMonth.slice(5, 7)) }
                            : undefined
                        }
                        onChange={({ year, month }) =>
                          setForm((f) => ({ ...f, activeUntilMonth: `${year}-${String(month).padStart(2, "0")}` }))
                        }
                        placeholder="現在も稼働中"
                      />
                      {form.activeUntilMonth && (
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, activeUntilMonth: "" }))}
                          className="text-xs text-slate-400 hover:text-slate-600 whitespace-nowrap"
                        >
                          クリア
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-200">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1">
                  <FontAwesomeIcon icon={faIdCard} className="w-3.5 h-3.5 text-slate-400" />
                  運転免許証
                </h3>
                <p className="text-xs text-slate-500 mb-3">有効期限の管理（一覧では期限色で表示されます）</p>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">有効期限</label>
                  <DatePicker
                    value={
                      form.licenseExpiryDate && /^\d{4}-\d{2}-\d{2}$/.test(form.licenseExpiryDate)
                        ? new Date(form.licenseExpiryDate + "T12:00:00")
                        : undefined
                    }
                    onChange={(d) =>
                      setForm((f) => ({
                        ...f,
                        licenseExpiryDate: d ? format(d, "yyyy-MM-dd") : "",
                      }))
                    }
                    placeholder="日付を選択"
                    className="w-full h-11"
                  />
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-200">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1">
                  <FontAwesomeIcon icon={faMoneyBillWave} className="w-3.5 h-3.5 text-slate-400" />
                  リース
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  リース方式を選びます。<strong>月額</strong>＝毎月固定額を日当から控除（コースの日額リース代は免除）。
                  <strong>日毎</strong>＝走ったコースの日額リース代×稼働日数を日当から控除（金額はコース側で設定）。
                </p>
                {leaseLoading ? (
                  <p className="text-xs text-slate-400">読み込み中…</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      {([
                        { key: "NONE", label: "リースなし" },
                        { key: "MONTHLY", label: "月額" },
                        { key: "DAILY", label: "日毎" },
                      ] as const).map((o) => {
                        const active = o.key === "NONE" ? !leaseForm.enabled : leaseForm.enabled && leaseForm.mode === o.key;
                        return (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() =>
                              setLeaseForm((f) =>
                                o.key === "NONE"
                                  ? { ...f, enabled: false }
                                  : { ...f, enabled: true, mode: o.key },
                              )
                            }
                            className={`px-4 py-1.5 rounded text-sm font-medium border transition-colors ${
                              active
                                ? "bg-slate-800 text-white border-slate-800"
                                : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>

                    {leaseForm.enabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {leaseForm.mode === "MONTHLY" ? (
                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">月額（円 / 月・固定）</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={leaseForm.amount}
                              onChange={(e) =>
                                setLeaseForm((f) => ({ ...f, amount: e.target.value.replace(/\D/g, "") }))
                              }
                              placeholder="35000"
                              className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                          </div>
                        ) : (
                          <div className="col-span-1 flex items-end">
                            <p className="text-xs text-slate-500">
                              日額の金額は<strong>コースの「日額リース代」</strong>を使用します（コース管理で設定）。
                            </p>
                          </div>
                        )}
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1">適用開始月</label>
                          <MonthYearPicker
                            value={{
                              year: Number(leaseForm.validFrom.slice(0, 4)) || new Date().getFullYear(),
                              month: Number(leaseForm.validFrom.slice(5, 7)) || new Date().getMonth() + 1,
                            }}
                            onChange={({ year, month }) =>
                              setLeaseForm((f) => ({
                                ...f,
                                validFrom: `${year}-${String(month).padStart(2, "0")}-01`,
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              </>
              )}

              {modalTab === "basic" && (
              <>
              <div className="pt-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2 mb-3">
                  <FontAwesomeIcon icon={faPhone} className="w-3.5 h-3.5 text-slate-400" />
                  連絡先
                </div>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-400 mb-1">郵便番号</label>
                      <input
                        type="text"
                        value={form.postalCode}
                        onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                        onBlur={(e) => {
                          const raw = (e.target as HTMLInputElement).value;
                          const half = toHalfWidth(raw).replace(/[^\d-]/g, "");
                          setForm((f) => ({ ...f, postalCode: half }));
                          if (half.replace(/-/g, "").length === 7) fetchAddressFromPostalCode(half);
                        }}
                        placeholder="1234567 または 123-4567"
                        maxLength={10}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => fetchAddressFromPostalCode()}
                        disabled={postalLoading || toHalfWidth(form.postalCode).replace(/[-\s]/g, "").replace(/\D/g, "").length < 7}
                        className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {postalLoading ? "検索中..." : "住所検索"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">住所</label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="京都市○○区○○1-2-3"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
                      電話番号
                      {editingDriver && (
                        editingDriver.phone_verified_at ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                            <FontAwesomeIcon icon={faCircleCheck} className="w-2.5 h-2.5" />
                            認証済み
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                            <FontAwesomeIcon icon={faTriangleExclamation} className="w-2.5 h-2.5" />
                            未認証
                          </span>
                        )
                      )}
                    </label>
                    <input
                      type="text"
                      value={editingDriver?.phone_verified_at ? formatJPPhoneDisplay(form.phone) : form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      onBlur={(e) => {
                        const half = toHalfWidth((e.target as HTMLInputElement).value);
                        setForm((f) => ({ ...f, phone: half }));
                      }}
                      placeholder="03-1234-5678"
                      disabled={!!editingDriver?.phone_verified_at}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    {editingDriver?.phone_verified_at && (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-slate-400">
                          認証済みのため編集できません。番号を変える場合は削除してください。
                        </p>
                        <button
                          type="button"
                          onClick={() => unlinkPhone(editingDriver.id)}
                          className="shrink-0 text-[11px] text-red-600 hover:text-red-700 hover:underline"
                        >
                          削除
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Passkey</label>
                    {editingDriver?.has_passkey ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                        <FontAwesomeIcon icon={faCircleCheck} className="w-2.5 h-2.5" />
                        登録済み
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">
                        未登録
                      </span>
                    )}
                  </div>
                </div>
              </div>
              </>
              )}

              {modalTab === "contract" && (
              <>
              <div className="pt-4 mt-4 border-t border-slate-200">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <FontAwesomeIcon icon={faBuildingColumns} className="w-3.5 h-3.5 text-slate-400" />
                  口座（振込先）
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">金融機関名（機関名）</label>
                      <input
                        type="text"
                        value={form.bankInstitution}
                        onChange={(e) => setForm((f) => ({ ...f, bankInstitution: e.target.value }))}
                        placeholder="〇〇銀行"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">支店名</label>
                      <input
                        type="text"
                        value={form.bankBranch}
                        onChange={(e) => setForm((f) => ({ ...f, bankBranch: e.target.value }))}
                        placeholder="〇〇支店"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">口座種別</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {BANK_TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, bankType: t.value, bankTypeOther: t.value === "その他" ? f.bankTypeOther : "" }))}
                          className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${form.bankType === t.value
                            ? "bg-slate-800 text-white border-slate-800"
                            : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {form.bankType === "その他" && (
                      <input
                        type="text"
                        value={form.bankTypeOther}
                        onChange={(e) => setForm((f) => ({ ...f, bankTypeOther: e.target.value }))}
                        placeholder="口座種別を入力（例：定期）"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">口座番号</label>
                    <input
                      type="text"
                      value={form.bankNumber}
                      onChange={(e) => setForm((f) => ({ ...f, bankNumber: e.target.value.replace(/\D/g, "") }))}
                      placeholder="1234567"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">口座名義</label>
                    <input
                      type="text"
                      value={form.bankHolder}
                      onChange={(e) => setForm((f) => ({ ...f, bankHolder: e.target.value }))}
                      placeholder="ヤマダ タロウ"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>
              </div>
              </>
              )}

            </div>
            </>
            )}
            </div>

            <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-slate-100 shrink-0">
              <div>
                {editingDriver && !modalLoading && (
                  <button
                    onClick={() => deleteDriver(editingDriver.id, editingDriver.name)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                    削除
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {editingDriver ? (
                  <>
                    <span className="text-xs text-slate-400">
                      {autoSaveStatus === "saving"
                        ? "保存中…"
                        : autoSaveStatus === "saved"
                          ? "自動保存しました"
                          : autoSaveStatus === "error"
                            ? "保存に失敗しました"
                            : "変更は自動保存されます"}
                    </span>
                    <button
                      onClick={() => setShowModal(false)}
                      className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
                    >
                      閉じる
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowModal(false)}
                      className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={() => save()}
                      disabled={saving || modalLoading || !isFormValid}
                      className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "保存中..." : "追加"}
                    </button>
                  </>
                )}
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
