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
import { getCompany } from "@/config/companies";
import { canAdminWrite } from "@/lib/authz";
import { faPenToSquare, faTrash } from "@fortawesome/free-solid-svg-icons";

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
  postal_code?: string | null;
  address?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  bank_no?: string | null;
  bank_holder?: string | null;
  driver_courses: { course_id: string; courses: Course }[];
};

type DriverFixedExpense = {
  id: string;
  driver_id: string;
  name: string;
  amount: number;
  cycle: "MONTHLY";
  valid_from: string;
  valid_to: string | null;
};

const COMPANY_CODE = getCompany(process.env.NEXT_PUBLIC_COMPANY_CODE).code;

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

export default function UsersPage() {
  const [canWrite, setCanWrite] = useState(false);
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
    postalCode: "",
    address: "",
    phone: "",
    bankInstitution: "",
    bankBranch: "",
    bankType: "",
    bankTypeOther: "", // その他選択時の入力値
    bankNumber: "",
    bankHolder: "",
  });
  const [fixedExpenses, setFixedExpenses] = useState<DriverFixedExpense[]>([]);
  const [fixedLoading, setFixedLoading] = useState(false);
  const [fixedSaving, setFixedSaving] = useState(false);
  const [fixedForm, setFixedForm] = useState<{
    name: string;
    amount: string;
    validFromMonth: string;
    validToMonth: string;
  }>({
    name: "",
    amount: "",
    validFromMonth: "",
    validToMonth: "",
  });
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

  useEffect(() => {
    const stored = getStoredDriver();
    setCanWrite(canAdminWrite(stored?.role));
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
    if (!canWrite) return;
    setEditingDriver(null);
    setForm({
      name: "",
      displayName: "",
      officeCode: "",
      driverNumber: "",
      courseIds: [],
      postalCode: "",
      address: "",
      phone: "",
      bankInstitution: "",
      bankBranch: "",
      bankType: "",
      bankTypeOther: "",
      bankNumber: "",
      bankHolder: "",
    });
    setFixedExpenses([]);
    setFixedForm({
      name: "",
      amount: "",
      validFromMonth: "",
      validToMonth: "",
    });
    setShowModal(true);
  };

  const openEdit = (d: Driver) => {
    if (!canWrite) return;
    setEditingDriver(d);
    const { institution, branch } = parseBankName(d.bank_name || "");
    const { type, number, typeOther } = parseBankNo(d.bank_no || "");
    setForm({
      name: d.name,
      displayName: d.display_name?.trim() ?? getDisplayName(d),
      officeCode: d.office_code || "",
      driverNumber: d.driver_code?.slice(3) || "",
      courseIds: d.driver_courses.map((dc) => dc.course_id),
      postalCode: d.postal_code || "",
      address: d.address || "",
      phone: d.phone || "",
      bankInstitution: institution,
      bankBranch: branch,
      bankType: type,
      bankTypeOther: typeOther,
      bankNumber: number,
      bankHolder: d.bank_holder || "",
    });
    setFixedExpenses([]);
    setFixedForm({
      name: "",
      amount: "",
      validFromMonth: "",
      validToMonth: "",
    });
    // 固定経費を読み込み
    loadFixedExpenses(d.id);
    setShowModal(true);
  };

  const loadFixedExpenses = async (driverId: string) => {
    setFixedLoading(true);
    try {
      const res = await apiFetch<{ expenses: DriverFixedExpense[] }>(
        `/api/admin/driver-expenses?driver_id=${driverId}`,
      );
      setFixedExpenses(res.expenses ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setFixedLoading(false);
    }
  };

  const monthToStartDate = (month: string): string | null => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
    return `${month}-01`;
  };

  const monthToEndDate = (month: string): string | null => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
    const [y, m] = month.split("-");
    const year = Number(y);
    const mon = Number(m);
    if (!Number.isFinite(year) || !Number.isFinite(mon)) return null;
    const lastDay = new Date(year, mon, 0).getDate();
    return `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  };

  const handleAddFixedExpense = async () => {
    if (!editingDriver) return;
    if (!fixedForm.name.trim()) {
      setErrorState({
        title: "経費名を入力してください",
        message: "固定経費の名前を入力してください。",
      });
      return;
    }
    const amountValue = Number(fixedForm.amount);
    if (!fixedForm.amount || Number.isNaN(amountValue) || amountValue <= 0) {
      setErrorState({
        title: "月額の入力が不正です",
        message: "月額は1円以上の数値で入力してください。",
      });
      return;
    }

    const validFrom =
      monthToStartDate(fixedForm.validFromMonth) ?? undefined;
    const validTo =
      fixedForm.validToMonth && monthToEndDate(fixedForm.validToMonth)
        ? monthToEndDate(fixedForm.validToMonth)
        : null;

    setFixedSaving(true);
    try {
      await apiFetch("/api/admin/driver-expenses", {
        method: "POST",
        body: JSON.stringify({
          driver_id: editingDriver.id,
          name: fixedForm.name.trim(),
          amount: Math.floor(amountValue),
          valid_from: validFrom,
          valid_to: validTo,
        }),
      });
      setFixedForm({
        name: "",
        amount: "",
        validFromMonth: "",
        validToMonth: "",
      });
      await loadFixedExpenses(editingDriver.id);
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "固定経費の追加に失敗しました",
        message:
          "サーバーでエラーが発生したため、固定経費を追加できませんでした。\n\n" +
          "入力内容を確認のうえ、もう一度お試しください。",
        detail: reason || undefined,
      });
    } finally {
      setFixedSaving(false);
    }
  };

  const handleDeleteFixedExpense = async (expense: DriverFixedExpense) => {
    if (!editingDriver) return;
    setConfirmState({
      message: `「${expense.name}」を削除しますか？`,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/driver-expenses/${expense.id}`, {
            method: "DELETE",
          });
          await loadFixedExpenses(editingDriver.id);
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "固定経費の削除に失敗しました",
            message:
              "サーバーでエラーが発生したため、この固定経費を削除できませんでした。",
            detail: reason || undefined,
          });
        }
      },
    });
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

  const save = async () => {
    if (!canWrite) return;
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
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            bankName: [form.bankInstitution, form.bankBranch].filter(Boolean).join(" ") || null,
            bankNo: [getBankTypeForSave(), form.bankNumber].filter(Boolean).join(" ") || null,
            bankHolder: form.bankHolder.trim() || null,
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
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            bankName: [form.bankInstitution, form.bankBranch].filter(Boolean).join(" ") || null,
            bankNo: [getBankTypeForSave(), form.bankNumber].filter(Boolean).join(" ") || null,
            bankHolder: form.bankHolder.trim() || null,
          }),
        });
      }
      setShowModal(false);
      load();
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
          load();
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

  const isFormValid = form.name.trim() &&
    form.officeCode.length === 6 &&
    /^\d{6}$/.test(form.officeCode) &&
    form.driverNumber.length === 6 &&
    /^\d{6}$/.test(form.driverNumber);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">ドライバー管理</h1>
            <p className="text-sm text-slate-500 mt-0.5">会社コード: {companyCode}</p>
          </div>
          {canWrite && (
            <button
              onClick={openNew}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規追加
            </button>
          )}
        </div>

        {loading ? (
          <div className="bg-white rounded border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-2.5 px-4 text-left"><Skeleton className="h-4 w-12" /></th>
                  <th className="py-2.5 px-4 text-left"><Skeleton className="h-4 w-14" /></th>
                  <th className="py-2.5 px-4 text-left"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-2.5 px-4 text-left"><Skeleton className="h-4 w-14" /></th>
                  <th className="py-2.5 px-4 text-left"><Skeleton className="h-4 w-20" /></th>
                  <th className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-10 ml-auto" /></th>
                </tr>
              </thead>
              <tbody>
                {[...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2.5 px-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="py-2.5 px-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="py-2.5 px-4"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-2.5 px-4"><Skeleton className="h-4 w-12" /></td>
                    <td className="py-2.5 px-4"><Skeleton className="h-5 w-24" /></td>
                    <td className="py-2.5 px-4 text-right"><Skeleton className="h-4 w-14 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                      {canWrite && (
                        <>
                          <button
                            onClick={() => openEdit(d)}
                            className="text-sm text-slate-500 hover:text-slate-800 mr-3 transition-colors"
                          >
                            <FontAwesomeIcon icon={faPenToSquare} />
                          </button>
                          <button
                            onClick={() => deleteDriver(d.id, d.name)}
                            className="pl-3 text-sm text-red-500 hover:text-red-700 transition-colors"
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingDriver ? "ドライバー編集" : "新規ドライバー追加"}
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
                    className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  この6桁が初回ログイン時のPINになります
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
                <h3 className="text-sm font-semibold text-slate-700 mb-3">請求書用情報（個人）</h3>
                <p className="text-xs text-slate-500 mb-3">請求書の請求元として使用する際の住所・振込先情報</p>
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

              {editingDriver && (
                <div className="pt-4 mt-4 border-t border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">
                    固定経費
                  </h3>
                  <p className="text-xs text-slate-500 mb-3">
                    ドライバーごとの月額固定経費（リース代・事務手数料など）を登録します。報酬サマリで固定控除として集計されます。
                  </p>

                  <div className="space-y-3 mb-4">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          経費名
                        </label>
                        <input
                          type="text"
                          value={fixedForm.name}
                          onChange={(e) =>
                            setFixedForm((f) => ({ ...f, name: e.target.value }))
                          }
                          placeholder="リース代 など"
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                      <div className="w-32">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          月額（円）
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={fixedForm.amount}
                          onChange={(e) =>
                            setFixedForm((f) => ({
                              ...f,
                              amount: e.target.value.replace(/[^0-9]/g, ""),
                            }))
                          }
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 text-right"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          有効開始月
                        </label>
                        <input
                          type="month"
                          value={fixedForm.validFromMonth}
                          onChange={(e) =>
                            setFixedForm((f) => ({
                              ...f,
                              validFromMonth: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          有効終了月（任意）
                        </label>
                        <input
                          type="month"
                          value={fixedForm.validToMonth}
                          onChange={(e) =>
                            setFixedForm((f) => ({
                              ...f,
                              validToMonth: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddFixedExpense}
                        disabled={fixedSaving}
                        className="px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
                      >
                        {fixedSaving ? "追加中..." : "固定経費を追加"}
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded">
                    {fixedLoading ? (
                      <div className="p-3 space-y-2">
                        {[...Array(3)].map((_, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2"
                          >
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-4 w-40" />
                          </div>
                        ))}
                      </div>
                    ) : fixedExpenses.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-500">
                        登録されている固定経費はありません
                      </p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-100">
                            <th className="py-1.5 px-3 text-left font-medium text-slate-600">
                              経費名
                            </th>
                            <th className="py-1.5 px-3 text-right font-medium text-slate-600">
                              月額（円）
                            </th>
                            <th className="py-1.5 px-3 text-left font-medium text-slate-600">
                              有効期間
                            </th>
                            <th className="py-1.5 px-3 text-right font-medium text-slate-600">
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {fixedExpenses.map((exp) => {
                            const fromLabel = exp.valid_from
                              ? String(exp.valid_from).slice(0, 7)
                              : "-";
                            const toLabel = exp.valid_to
                              ? String(exp.valid_to).slice(0, 7)
                              : "継続";
                            return (
                              <tr
                                key={exp.id}
                                className="border-t border-slate-200 last:border-b-0"
                              >
                                <td className="py-1.5 px-3">
                                  <span className="text-slate-800">
                                    {exp.name}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 text-right tabular-nums">
                                  {exp.amount.toLocaleString()}
                                </td>
                                <td className="py-1.5 px-3 text-slate-600">
                                  {fromLabel} 〜 {toLabel}
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeleteFixedExpense(exp)
                                    }
                                    className="text-[11px] text-red-500 hover:text-red-700"
                                  >
                                    削除
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
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
