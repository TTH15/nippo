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
import { Button } from "@/lib/ui/button";
import { faTrash, faUser } from "@fortawesome/free-solid-svg-icons";
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
  company_code?: string;
  office_code: string;
  driver_code: string;
  /** 会社内ドライバー一覧の通し番号（永続） */
  list_no?: number | null;
  created_at?: string;
  license_expiry_date?: string | null;
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
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const usersPageKey = (pageIndex: number, previousPageData: UsersPageResponse | null) => {
    if (previousPageData && !previousPageData.hasMore) return null;
    const cursor = previousPageData?.nextCursor ?? "0";
    return `/api/admin/users?limit=${USERS_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`;
  };

  const { data: usersPages, isLoading: usersLoading, isValidating: usersValidating, setSize } =
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

  useEffect(() => {
    setDrivers((prev) => {
      if (flattenedDrivers.length === 0 && prev.length === 0) return prev;
      const prevById = new Map(prev.map((d) => [d.id, d]));
      const merged = flattenedDrivers.map((d) => prevById.get(d.id) ?? d);
      const missingLocal = prev.filter((d) => !merged.some((x) => x.id === d.id));
      return sortDrivers([...merged, ...missingLocal]);
    });
  }, [flattenedDrivers]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      if (!hasMore) return;
      void setSize((s) => s + 1);
    });
    observer.observe(node);
    return () => observer.disconnect();
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
    });
    setLeaseForm({ ...EMPTY_LEASE, validFrom: currentMonthStartStr() });
    setShowModal(true);
  };

  const openEdit = async (d: Driver) => {
    if (!canWrite) return;
    // まず詳細モーダルをスケルトンで即時表示し、取得完了まで loading にする
    setEditingDriver(d);
    setModalLoading(true);
    setModalTab("basic");
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
      });
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

  const save = async () => {
    if (!canWrite) return;
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

      setShowModal(false);
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "ドライバー情報の保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、ドライバー情報を保存できませんでした。\n\n" +
          "入力内容（コードの重複や必須項目の抜けなど）を確認し、もう一度保存してください。\n" +
          "同じエラーが続く場合は、システム管理者に連絡してください。",
        detail: reason || undefined,
      });
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

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">ドライバー管理</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              会社コード: {companyCode}
              <span className="text-slate-400"> · 並び順: No.（昇順）、同値時は名前順</span>
            </p>
          </div>
          {canWrite && (
            <Button variant="default" size="default" onClick={openNew}>
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規追加
            </Button>
          )}
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
            <div className="overflow-x-auto table-scroll table-scroll-fade">
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
            <div ref={loadMoreRef} className="h-8" />
            {hasMore && (
              <div className="text-center text-xs text-slate-500 py-2">さらに読み込み中...</div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingDriver ? "ドライバー編集" : "新規ドライバー追加"}
            </h2>

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

              {editingDriver && roleOptions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ロール・権限</label>
                  <select
                    value={form.roleId}
                    onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="">（変更しない）</option>
                    {roleOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    権限の内容は「設定 → ロール・権限」で編集できます。
                  </p>
                </div>
              )}
              </>
              )}

              {modalTab === "work" && (
              <>
              <p className="text-xs font-semibold text-slate-600 pt-1">勤務区分1</p>
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
                    className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  この6桁が初回ログイン時のPINになります
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">担当可能コース（区分1）</label>
                <div className="flex flex-wrap gap-2">
                  {courses.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCourse(c.id)}
                      className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${form.courseIds.includes(c.id)
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

              <div className="pt-4 mt-4 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-600 mb-2">勤務区分2（任意）</p>
                <p className="text-xs text-slate-500 mb-3">
                  別コード・別事業所で日報を分ける場合。未入力のままなら区分2は無効です。
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">事業所コード（6桁）</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={form.officeCode2}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "");
                        setForm((f) => ({ ...f, officeCode2: v }));
                      }}
                      placeholder="000000"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">ドライバーコード</label>
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
                        className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">担当可能コース（区分2）</label>
                    <div className="flex flex-wrap gap-2">
                      {courses.map((c) => (
                        <button
                          key={`s2-${c.id}`}
                          type="button"
                          onClick={() => toggleCourse2(c.id)}
                          className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${form.courseIds2.includes(c.id)
                            ? "text-white border-transparent"
                            : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                          style={form.courseIds2.includes(c.id) ? { backgroundColor: c.color } : {}}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              </>
              )}

              {modalTab === "contract" && (
              <>
              <div className="pt-4 mt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700 mb-1">運転免許証</h3>
                <p className="text-xs text-slate-500 mb-3">有効期限の管理（一覧では期限色で表示されます）</p>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">有効期限</label>
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
                <h3 className="text-sm font-semibold text-slate-700 mb-1">リース</h3>
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
                      <div className="grid grid-cols-2 gap-3">
                        {leaseForm.mode === "MONTHLY" ? (
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">月額（円 / 月・固定）</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={leaseForm.amount}
                              onChange={(e) =>
                                setLeaseForm((f) => ({ ...f, amount: e.target.value.replace(/\D/g, "") }))
                              }
                              placeholder="35000"
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
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
                          <label className="block text-xs font-medium text-slate-600 mb-1">適用開始月</label>
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
              <div className="pt-4 mt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">住所・連絡先</h3>
                <p className="text-xs text-slate-500 mb-3">請求書の請求元（個人）として使用する住所・電話</p>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1">郵便番号</label>
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
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
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
                    <label className="block text-xs font-medium text-slate-600 mb-1">住所</label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="京都市○○区○○1-2-3"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">電話番号</label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      onBlur={(e) => {
                        const half = toHalfWidth((e.target as HTMLInputElement).value);
                        setForm((f) => ({ ...f, phone: half }));
                      }}
                      placeholder="03-1234-5678"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>
              </div>
              </>
              )}

              {modalTab === "contract" && (
              <>
              <div className="pt-4 mt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">口座（振込先）</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">金融機関名（機関名）</label>
                      <input
                        type="text"
                        value={form.bankInstitution}
                        onChange={(e) => setForm((f) => ({ ...f, bankInstitution: e.target.value }))}
                        placeholder="〇〇銀行"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">支店名</label>
                      <input
                        type="text"
                        value={form.bankBranch}
                        onChange={(e) => setForm((f) => ({ ...f, bankBranch: e.target.value }))}
                        placeholder="〇〇支店"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">口座種別</label>
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
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">口座番号</label>
                    <input
                      type="text"
                      value={form.bankNumber}
                      onChange={(e) => setForm((f) => ({ ...f, bankNumber: e.target.value.replace(/\D/g, "") }))}
                      placeholder="1234567"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">口座名義</label>
                    <input
                      type="text"
                      value={form.bankHolder}
                      onChange={(e) => setForm((f) => ({ ...f, bankHolder: e.target.value }))}
                      placeholder="ヤマダ タロウ"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>
              </div>
              </>
              )}

            </div>
            </>
            )}

            <div className="flex items-center justify-between gap-2 mt-6">
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={save}
                  disabled={saving || modalLoading || !isFormValid}
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
