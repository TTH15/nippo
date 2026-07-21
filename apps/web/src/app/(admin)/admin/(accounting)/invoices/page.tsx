"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFolder, faFileInvoice, faPenToSquare, faPlus, faTrashCan, faEye, faStar } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { Button } from "@/lib/ui/button";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";

type SavedInvoice = {
  direction?: "outgoing" | "incoming";
  counterpartyName?: string;
  id: string;
  clientName: string;
  issueDate: string;
  amount: number;
  status: "draft" | "pending_approval" | "approved" | "paid";
  month?: string;
  section?: "Amazon" | "ヤマト運輸" | "郵便局";
  invoiceNo?: string;
  starred?: boolean;
  counterpartyInvoiceAddressId?: string | null;
  updatedAt?: string | null;
};
type DriverFolder = { id: string; name: string; display_name?: string | null };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const FINDER_STATE_STORAGE_KEY = "admin_invoices_finder_state_v1";
const FOLDER_STATUS_PRIORITY: SavedInvoice["status"][] = ["draft", "pending_approval", "approved", "paid"];

const statusLabel: Record<SavedInvoice["status"], { text: string; cls: string }> = {
  draft: { text: "下書き", cls: "bg-slate-100 text-slate-600" },
  pending_approval: { text: "承認待ち", cls: "bg-amber-50 text-amber-700" },
  approved: { text: "承認済", cls: "bg-blue-50 text-blue-700" },
  paid: { text: "入金済", cls: "bg-emerald-50 text-emerald-700" },
};

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

const statusOptions: { value: SavedInvoice["status"]; label: string }[] = [
  { value: "draft", label: "下書き" },
  { value: "pending_approval", label: "承認待ち" },
  { value: "approved", label: "承認済" },
  { value: "paid", label: "入金済" },
];

const directionOptions: { value: "outgoing" | "incoming"; label: string }[] = [
  { value: "outgoing", label: "自社が請求" },
  { value: "incoming", label: "自社に請求" },
];

type FinderState = {
  selectedMonth?: string;
  selectedDirection?: "outgoing" | "incoming";
  selectedCounterparty?: string;
  filter?: "all" | SavedInvoice["status"];
};

function readFinderState(): FinderState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FINDER_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FinderState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getFolderTopStatus(items: SavedInvoice[]): SavedInvoice["status"] | null {
  if (items.length === 0) return null;
  const rank = new Map(FOLDER_STATUS_PRIORITY.map((s, i) => [s, i]));
  return items.reduce<SavedInvoice["status"]>((top, item) => {
    const currentRank = rank.get(item.status) ?? -1;
    const topRank = rank.get(top) ?? -1;
    return currentRank > topRank ? item.status : top;
  }, "draft");
}

function getFolderStatusUi(status: SavedInvoice["status"] | null): { dotCls: string; text: string } {
  if (!status) {
    return { dotCls: "", text: "" };
  }
  if (status === "draft") {
    return { dotCls: "bg-slate-400", text: "下書き" };
  }
  if (status === "pending_approval") {
    return { dotCls: "bg-amber-400", text: "承認待ち" };
  }
  if (status === "approved") {
    return { dotCls: "bg-blue-400", text: "承認済み" };
  }
  return { dotCls: "bg-emerald-400", text: "入金済み" };
}

function isFullWidthChar(ch: string): boolean {
  // CJK / 全角記号 / かな等を概ね全角として扱う
  return /[^\u0020-\u007E]/.test(ch);
}

function truncateByDisplayWidth(value: string, maxWidth: number): string {
  let width = 0;
  let out = "";
  for (const ch of value) {
    const w = isFullWidthChar(ch) ? 2 : 1;
    if (width + w > maxWidth) return `${out}…`;
    out += ch;
    width += w;
  }
  return out;
}

export default function InvoicesPage() {
  const initialFinderState = readFinderState();
  const [canWrite, setCanWrite] = useState(false);
  const [invoices, setInvoices] = useState<SavedInvoice[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCreatePicker, setShowCreatePicker] = useState(false);
  // 作成ピッカーで選ぶ請求先（法人アドレスID）。売上は取引先ごとに明細経路で作成する。
  const [createCounterpartyId, setCreateCounterpartyId] = useState<string>("");
  // 作成ピッカーで選ぶドライバー。受領はドライバーごとに自動集計して作成する。
  const [createDriverId, setCreateDriverId] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    if (initialFinderState.selectedMonth && /^\d{4}-\d{2}$/.test(initialFinderState.selectedMonth)) {
      return initialFinderState.selectedMonth;
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });
  const [selectedDirection, setSelectedDirection] = useState<"outgoing" | "incoming">(
    initialFinderState.selectedDirection === "incoming" ? "incoming" : "outgoing",
  );
  const [selectedCounterparty, setSelectedCounterparty] = useState<string>(
    initialFinderState.selectedCounterparty ?? "",
  );
  const [filter, setFilter] = useState<"all" | SavedInvoice["status"]>(
    initialFinderState.filter === "draft" ||
      initialFinderState.filter === "pending_approval" ||
      initialFinderState.filter === "approved" ||
      initialFinderState.filter === "paid"
      ? initialFinderState.filter
      : "all",
  );
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [drivers, setDrivers] = useState<DriverFolder[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const starSyncTimerRef = useRef<number | null>(null);
  const pendingStarUpdatesRef = useRef<Map<string, boolean>>(new Map());

  const monthFolders = Array.from(new Set((invoices ?? []).map((i) => i.month).filter(Boolean))).sort().reverse();
  const directionFolders = (["outgoing", "incoming"] as const).filter((d) =>
    invoices.some((i) => (i.month ?? "") === selectedMonth && (i.direction ?? "outgoing") === d)
  );
  const counterpartyFolders = useMemo(() => {
    if (selectedDirection === "incoming") {
      return drivers
        .map((d) => d.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ja"));
    }
    return Array.from(
      new Set(
        invoices
          .filter(
            (i) =>
              (i.month ?? "") === selectedMonth &&
              (i.direction ?? "outgoing") === selectedDirection
          )
          .map((i) => i.counterpartyName || i.clientName || "未設定")
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "ja"));
  }, [drivers, invoices, selectedDirection, selectedMonth]);
  const selectedDriver = useMemo(
    () => drivers.find((d) => d.name === selectedCounterparty) ?? null,
    [drivers, selectedCounterparty],
  );
  const counterpartyStatusMap = useMemo(() => {
    const map = new Map<string, SavedInvoice["status"] | null>();
    for (const name of counterpartyFolders) {
      const folderInvoices = invoices.filter(
        (i) =>
          (i.month ?? "") === selectedMonth &&
          (i.direction ?? "outgoing") === selectedDirection &&
          (i.counterpartyName || i.clientName || "未設定") === name,
      );
      map.set(name, getFolderTopStatus(folderInvoices));
    }
    return map;
  }, [counterpartyFolders, invoices, selectedDirection, selectedMonth]);
  const filtered = (filter === "all" ? invoices : invoices.filter((inv) => inv.status === filter)).filter((inv) => {
    if (selectedMonth && inv.month !== selectedMonth) return false;
    if ((inv.direction ?? "outgoing") !== selectedDirection) return false;
    if (!selectedCounterparty) return true;
    return (inv.counterpartyName || inv.clientName || "未設定") === selectedCounterparty;
  });

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_billing"));
  }, []);

  // SWR で請求書一覧をキャッシュし、遷移をまたいで保持する（再訪時の点滅をなくす）。
  const {
    data: invoicesData,
    error: invoicesError,
    isInitialLoading,
    mutate: mutateInvoices,
  } = useApi<{ invoices: SavedInvoice[] }>("/api/admin/invoices");
  const loading = isInitialLoading;

  useEffect(() => {
    if (invoicesData) {
      setInvoices(invoicesData.invoices ?? []);
      setErrorMessage(null);
    }
  }, [invoicesData]);

  useEffect(() => {
    if (invoicesError) {
      setErrorMessage(
        "請求書一覧の取得に失敗しました。migration未適用やDBエラーの可能性があります。",
      );
    }
  }, [invoicesError]);

  // 書き込み後の再取得（旧 load の代替）。
  const load = useCallback(() => mutateInvoices(), [mutateInvoices]);

  // ドライバ一覧はフォルダで選択中の年月時点で在籍していたドライバーだけに絞る
  // （稼働開始月/終了月ベース。status不問＝過去はinactiveでも当時在籍していれば出す）。
  // selectedMonth をキーに含めることで、年月フォルダを切り替えるたびに再取得する。
  const { data: driversData } = useApi<DriverFolder[]>(`admin/invoices:drivers:${selectedMonth}`, {
    fetcher: async () => {
      const res: { drivers: DriverFolder[] } = await apiFetch(
        `/api/admin/users?all=1&activeMonth=${encodeURIComponent(selectedMonth)}`,
      );
      return res.drivers ?? [];
    },
  });

  useEffect(() => {
    if (driversData) setDrivers(driversData);
  }, [driversData]);

  // 法人アドレス（請求先）一覧。作成ピッカーの取引先選択に使う。
  const { data: addressesData } = useApi<{ addresses: { id: string; name: string }[] }>(
    "/api/admin/invoice-addresses",
  );
  const invoiceAddresses = useMemo(
    () =>
      (addressesData?.addresses ?? [])
        .map((a) => ({ value: a.id, label: a.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "ja")),
    [addressesData],
  );
  // 作成ピッカーの受領（ドライバー）選択に使う。フォルダ表示用に取得済みの drivers を流用する。
  const driverOptions = useMemo(
    () =>
      drivers
        .map((d) => ({ value: d.id, label: d.display_name || d.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "ja")),
    [drivers],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const state: FinderState = {
      selectedMonth,
      selectedDirection,
      selectedCounterparty,
      filter,
    };
    window.localStorage.setItem(FINDER_STATE_STORAGE_KEY, JSON.stringify(state));
  }, [filter, selectedCounterparty, selectedDirection, selectedMonth]);

  useEffect(() => {
    return () => {
      if (starSyncTimerRef.current != null) {
        window.clearTimeout(starSyncTimerRef.current);
      }
    };
  }, []);

  const handleUploadForDriver = async (file: File) => {
    if (!selectedDriver || !canWrite) return;
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setErrorMessage("アップロード可能な形式は PDF / JPG / PNG のみです。");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMessage("ファイルサイズは5MB以下にしてください。");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("ファイル読み込みに失敗しました"));
        reader.readAsDataURL(file);
      });
      const [y, m] = selectedMonth.split("-").map(Number);
      const issueDate = (() => {
        const yy = m === 12 ? y + 1 : y;
        const mm = m === 12 ? 1 : m + 1;
        const dd = new Date(yy, mm, 0).getDate();
        return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      })();
      await apiFetch("/api/admin/invoices", {
        method: "POST",
        body: JSON.stringify({
          month: selectedMonth,
          section: "郵便局",
          clientName: selectedDriver.name,
          driverId: selectedDriver.id,
          issueDate,
          invoiceNo: `UPL-${selectedMonth.replace("-", "")}-${selectedDriver.id.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
          amount: 0,
          status: "pending_approval",
          payload: {
            source: "uploaded_document",
            toName: "株式会社ACE CREATION",
            fromName: selectedDriver.name,
            issueDate: `${issueDate.slice(0, 4)}年${Number(issueDate.slice(5, 7))}月${Number(issueDate.slice(8, 10))}日`,
            billAmountDisplay: "¥0",
            tableData: { main: [], deduct: [] },
            attachments: [{ name: file.name, type: file.type, dataUrl }],
            parties: { fromParty: `drv-${selectedDriver.id}`, toParty: "ace_creation" },
          },
        }),
      });
      void load();
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e?.message || "アップロードに失敗しました。");
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const updateStatus = async (invoiceId: string, status: SavedInvoice["status"]) => {
    if (!canWrite) return;
    setUpdatingStatusId(invoiceId);
    try {
      await apiFetch(`/api/admin/invoices/${encodeURIComponent(invoiceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? { ...inv, status } : inv)));
      void load(); // キャッシュも確定（待たない）
    } catch (e) {
      console.error(e);
      setErrorMessage("ステータス更新に失敗しました。");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const deleteInvoice = (invoiceId: string) => {
    if (!canWrite) return;
    setConfirmState({
      message: "この請求書を削除しますか？",
      onConfirm: () => void performDeleteInvoice(invoiceId),
    });
  };

  const performDeleteInvoice = async (invoiceId: string) => {
    if (!canWrite) return;
    setDeletingId(invoiceId);
    try {
      await apiFetch(`/api/admin/invoices/${encodeURIComponent(invoiceId)}`, {
        method: "DELETE",
      });
      setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId));
      void load(); // 削除した請求書が再訪時に復活しないように
    } catch (e) {
      console.error(e);
      setErrorMessage("請求書の削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
  };

  const flushPendingStarUpdates = useCallback(async () => {
    const entries = Array.from(pendingStarUpdatesRef.current.entries());
    if (entries.length === 0) return;
    pendingStarUpdatesRef.current.clear();
    const failed: Array<[string, boolean]> = [];
    await Promise.all(
      entries.map(async ([invoiceId, starred]) => {
        try {
          await apiFetch(`/api/admin/invoices/${encodeURIComponent(invoiceId)}`, {
            method: "PATCH",
            body: JSON.stringify({ starred }),
          });
        } catch (e) {
          console.error(e);
          failed.push([invoiceId, starred]);
        }
      })
    );
    if (failed.length > 0) {
      failed.forEach(([id, starred]) => pendingStarUpdatesRef.current.set(id, starred));
      setErrorMessage("スター更新に失敗したため再試行します。");
      if (starSyncTimerRef.current == null) {
        starSyncTimerRef.current = window.setTimeout(() => {
          starSyncTimerRef.current = null;
          void flushPendingStarUpdates();
        }, 1500);
      }
    }
  }, []);

  const scheduleStarSync = useCallback(() => {
    if (starSyncTimerRef.current != null) {
      window.clearTimeout(starSyncTimerRef.current);
    }
    starSyncTimerRef.current = window.setTimeout(() => {
      starSyncTimerRef.current = null;
      void flushPendingStarUpdates();
    }, 350);
  }, [flushPendingStarUpdates]);

  const toggleStar = (invoiceId: string, nextStarred: boolean) => {
    if (!canWrite) return;
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoiceId ? { ...inv, starred: nextStarred } : inv))
    );
    pendingStarUpdatesRef.current.set(invoiceId, nextStarred);
    scheduleStarSync();
  };

  useEffect(() => {
    if (directionFolders.length > 0 && !directionFolders.includes(selectedDirection)) {
      setSelectedDirection(directionFolders[0]);
    }
  }, [directionFolders, selectedDirection]);

  useEffect(() => {
    if (counterpartyFolders.length === 0) {
      setSelectedCounterparty("");
      return;
    }
    if (!selectedCounterparty || !counterpartyFolders.includes(selectedCounterparty)) {
      setSelectedCounterparty(counterpartyFolders[0]);
    }
  }, [counterpartyFolders, selectedCounterparty]);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faFileInvoice} className="w-5 h-5 text-slate-400" />
            請求書一覧
          </h1>
          {canWrite && (
            <Button variant="default" size="default" onClick={() => setShowCreatePicker(true)}>
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              保存先を選んで作成
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
          登録済みの請求データから請求書を作成・管理します。
          <a href="/admin/counterparties" className="underline hover:text-slate-700">取引先</a>
          からコース単位の集計を見ながら、ワンクリックで下書きを開けます。
        </p>

        {errorMessage && (
          <div className="mb-4 px-3 py-2 text-sm rounded border border-amber-200 bg-amber-50 text-amber-800">
            {errorMessage}
          </div>
        )}

        <div className="soft-rise bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-1 xl:grid-cols-[160px_180px_240px_1fr]">
            <div className="border-r border-slate-200 xl:min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">年月</div>
              <div className="p-2 space-y-1 max-h-40 overflow-y-auto xl:max-h-none xl:overflow-visible">
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <div key={`month-skel-${i}`} className="h-8 rounded bg-slate-100 animate-pulse" />
                  ))
                ) : monthFolders.length === 0 ? (
                  <p className="text-xs text-slate-400 px-2 py-1">月フォルダがありません</p>
                ) : (
                  monthFolders.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMonth(m!)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${selectedMonth === m ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                        }`}
                    >
                      <FontAwesomeIcon icon={faFolder} className="mr-2 text-slate-400" />
                      {m}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="border-r border-slate-200 xl:min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">請求方向</div>
              <div className="p-2 space-y-1 max-h-40 overflow-y-auto xl:max-h-none xl:overflow-visible">
                {loading ? (
                  [...Array(2)].map((_, i) => (
                    <div key={`dir-skel-${i}`} className="h-8 rounded bg-slate-100 animate-pulse" />
                  ))
                ) : (directionFolders.length === 0 ? (["outgoing", "incoming"] as const) : directionFolders).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setSelectedDirection(dir)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${selectedDirection === dir ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                      }`}
                  >
                    <FontAwesomeIcon icon={faFolder} className="mr-2 text-slate-400" />
                    {dir === "outgoing" ? "自社が請求" : "自社に請求"}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-r border-slate-200 xl:min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">取引先</div>
              <div className="p-2 space-y-1 max-h-40 overflow-y-auto xl:max-h-none xl:overflow-visible">
                {loading ? (
                  [...Array(10)].map((_, i) => (
                    <div key={`cp-skel-${i}`} className="h-8 rounded bg-slate-100 animate-pulse" />
                  ))
                ) : counterpartyFolders.length === 0 ? (
                  <p className="text-xs text-slate-400 px-2 py-1">取引先フォルダがありません</p>
                ) : (
                  counterpartyFolders.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setSelectedCounterparty(name)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${selectedCounterparty === name ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        <FontAwesomeIcon icon={faFolder} className="text-slate-400" />
                        <span className="min-w-0 flex-1 truncate" title={name}>
                          {truncateByDisplayWidth(name, 20)}
                        </span>
                        {(() => {
                          const topStatus = counterpartyStatusMap.get(name) ?? null;
                          const ui = getFolderStatusUi(topStatus);
                          return (
                            <>
                              {topStatus ? (
                                <span className="ml-auto inline-flex items-center shrink-0" title={ui.text}>
                                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${ui.dotCls}`} />
                                </span>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* 右ペイン */}
            <div className="xl:min-h-[520px] xl:max-h-[520px] xl:overflow-y-auto">
              <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
                {canWrite && selectedDirection === "incoming" && selectedDriver && (
                  <div className="p-3 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="text-xs text-slate-600">
                      {selectedMonth} / {selectedDriver.name} フォルダにPDF・画像をアップロード
                    </div>
                    <div>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleUploadForDriver(f);
                        }}
                      />
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => uploadInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-xs disabled:opacity-50"
                      >
                        {uploading ? "アップロード中..." : "PDF/画像を追加"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1 p-3 bg-slate-50/70">
                  {([
                    { key: "all", label: "すべて" },
                    { key: "draft", label: "下書き" },
                    { key: "pending_approval", label: "承認待ち" },
                    { key: "approved", label: "承認済" },
                    { key: "paid", label: "入金済" },
                  ] as const).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${filter === f.key
                          ? "bg-slate-800 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hidden md:block overflow-x-auto table-scroll table-scroll-fade">
                <table className="w-full min-w-[860px] text-sm table-fixed">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="w-[40px] text-center px-2 py-3 font-medium text-slate-600"></th>
                      <th className="w-[190px] text-left px-3 py-3 font-medium text-slate-600">請求書番号</th>
                      <th className="w-[190px] text-left px-3 py-3 font-medium text-slate-600">取引先</th>
                      <th className="w-[110px] text-left px-3 py-3 font-medium text-slate-600">発行日</th>
                      <th className="w-[110px] text-right px-3 py-3 font-medium text-slate-600">金額</th>
                      <th className="w-[120px] text-center px-3 py-3 font-medium text-slate-600">ステータス</th>
                      <th className="w-[130px] text-right px-3 py-3 font-medium text-slate-600"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                          読み込み中...
                        </td>
                      </tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                          該当する請求書はありません
                        </td>
                      </tr>
                    ) : (
                      filtered.map((inv) => {
                        const s = statusLabel[inv.status];
                        return (
                          <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                            <td className="px-2 py-3 align-middle text-center">
                              {canWrite ? (
                                <button
                                  type="button"
                                  title={inv.starred ? "スター解除" : "スターを付ける"}
                                  onClick={() => toggleStar(inv.id, !inv.starred)}
                                  className={`inline-flex items-center justify-center w-5 h-5 transition-colors ${inv.starred
                                      ? "text-amber-500"
                                      : "text-slate-300"
                                    }`}
                                >
                                  <FontAwesomeIcon icon={faStar} className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <span
                                  className={`inline-flex items-center justify-center w-5 h-5 ${inv.starred ? "text-amber-500" : "text-transparent"
                                    }`}
                                >
                                  <FontAwesomeIcon icon={faStar} className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 font-mono text-slate-700 break-all">
                              <span className="min-w-0">{inv.invoiceNo || inv.id}</span>
                            </td>
                            <td className="px-3 py-3 text-slate-900 font-medium">
                              <div className="inline-flex items-center gap-2 max-w-full">
                                <FontAwesomeIcon icon={faFileInvoice} className="text-slate-400" />
                                <span className="truncate inline-block max-w-[150px]" title={inv.counterpartyName || inv.clientName}>
                                  {inv.counterpartyName || inv.clientName}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{inv.issueDate}</td>
                            <td className="px-3 py-3 text-right font-medium text-slate-900 whitespace-nowrap">{fmt(inv.amount)}</td>
                            <td className="px-3 py-3 text-center">
                              {canWrite ? (
                                <CustomSelect
                                  options={statusOptions}
                                  value={inv.status}
                                  disabled={updatingStatusId === inv.id}
                                  onChange={(v) => void updateStatus(inv.id, v as SavedInvoice["status"])}
                                  clearable={false}
                                  size="sm"
                                />
                              ) : (
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
                                  {s.text}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              {canWrite ? (
                                (() => {
                                  const href = `/admin/invoices/${encodeURIComponent(inv.id)}/edit`;
                                  return (
                                    <div className="inline-flex items-center gap-2">
                                      {inv.status === "pending_approval" && (
                                        <a
                                          href={`/admin/invoices/${encodeURIComponent(inv.id)}/preview`}
                                          title="プレビュー"
                                          className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                                        >
                                          <FontAwesomeIcon icon={faEye} className="w-3.5 h-3.5" />
                                        </a>
                                      )}
                                      <a
                                        href={href}
                                        title="編集"
                                        className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                                      >
                                        <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
                                      </a>
                                      <button
                                        type="button"
                                        title="削除"
                                        disabled={deletingId === inv.id}
                                        onClick={() => void deleteInvoice(inv.id)}
                                        className="inline-flex items-center justify-center w-7 h-7 rounded border border-rose-200 text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                      >
                                        <FontAwesomeIcon icon={faTrashCan} className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  );
                                })()
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* モバイル：カード表示 */}
              <div className="md:hidden divide-y divide-slate-100">
                {loading ? (
                  <div className="px-4 py-8 text-center text-slate-400 text-sm">読み込み中...</div>
                ) : filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center text-slate-400 text-sm">
                    該当する請求書はありません
                  </div>
                ) : (
                  filtered.map((inv) => {
                    const s = statusLabel[inv.status];
                    return (
                      <div key={inv.id} className="p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-slate-900 font-medium">
                              <FontAwesomeIcon icon={faFileInvoice} className="text-slate-400 shrink-0" />
                              <span className="truncate" title={inv.counterpartyName || inv.clientName}>
                                {inv.counterpartyName || inv.clientName}
                              </span>
                            </div>
                            <p className="mt-1 font-mono text-xs text-slate-500 break-all">
                              {inv.invoiceNo || inv.id}
                            </p>
                          </div>
                          {canWrite ? (
                            <button
                              type="button"
                              title={inv.starred ? "スター解除" : "スターを付ける"}
                              onClick={() => toggleStar(inv.id, !inv.starred)}
                              className={`inline-flex items-center justify-center w-7 h-7 shrink-0 transition-colors ${inv.starred ? "text-amber-500" : "text-slate-300"
                                }`}
                            >
                              <FontAwesomeIcon icon={faStar} className="w-4 h-4" />
                            </button>
                          ) : inv.starred ? (
                            <span className="inline-flex items-center justify-center w-7 h-7 shrink-0 text-amber-500">
                              <FontAwesomeIcon icon={faStar} className="w-4 h-4" />
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-2.5 flex items-end justify-between gap-2">
                          <div className="text-xs text-slate-500">
                            <span className="whitespace-nowrap">{inv.issueDate}</span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                              {fmt(inv.amount)}
                            </span>
                          </div>
                          {canWrite ? (
                            <CustomSelect
                              options={statusOptions}
                              value={inv.status}
                              disabled={updatingStatusId === inv.id}
                              onChange={(v) => void updateStatus(inv.id, v as SavedInvoice["status"])}
                              clearable={false}
                              size="sm"
                              className="w-28"
                            />
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
                              {s.text}
                            </span>
                          )}
                        </div>

                        {canWrite && (
                          <div className="mt-3 flex items-center justify-end gap-2">
                            {inv.status === "pending_approval" && (
                              <a
                                href={`/admin/invoices/${encodeURIComponent(inv.id)}/preview`}
                                title="プレビュー"
                                className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200 text-slate-500 active:bg-slate-100"
                              >
                                <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
                              </a>
                            )}
                            <a
                              href={`/admin/invoices/${encodeURIComponent(inv.id)}/edit`}
                              title="編集"
                              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200 text-slate-500 active:bg-slate-100"
                            >
                              <FontAwesomeIcon icon={faPenToSquare} className="w-4 h-4" />
                            </a>
                            <button
                              type="button"
                              title="削除"
                              disabled={deletingId === inv.id}
                              onClick={() => void deleteInvoice(inv.id)}
                              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-rose-200 text-rose-500 active:bg-rose-50 disabled:opacity-50"
                            >
                              <FontAwesomeIcon icon={faTrashCan} className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreatePicker && (
        <div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreatePicker(false)}>
          <div className="modal-panel-in w-full max-w-md rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">保存先フォルダを選択</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">対象月フォルダ</label>
                <MonthYearPicker
                  value={
                    /^\d{4}-\d{2}/.test(selectedMonth)
                      ? { year: Number(selectedMonth.slice(0, 4)), month: Number(selectedMonth.slice(5, 7)) }
                      : undefined
                  }
                  onChange={({ year, month }) => setSelectedMonth(`${year}-${String(month).padStart(2, "0")}`)}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">請求方向フォルダ</label>
                <CustomSelect
                  options={directionOptions}
                  value={selectedDirection}
                  onChange={(v) => setSelectedDirection(v as "outgoing" | "incoming")}
                  clearable={false}
                  size="default"
                />
              </div>
              {selectedDirection === "outgoing" && (
                <div>
                  <label className="block text-xs text-slate-600 mb-1">請求先（取引先）</label>
                  <CustomSelect
                    options={invoiceAddresses}
                    value={createCounterpartyId}
                    onChange={(v) => setCreateCounterpartyId(v)}
                    placeholder="取引先を選択…"
                    clearable={false}
                    size="default"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                    取引先ごとに当月の売上明細を自動集計して下書きを作成します。
                    {invoiceAddresses.length === 0 && (
                      <>
                        {" "}
                        <a href="/admin/invoices/addressbook" className="underline hover:text-slate-600">
                          法人アドレス帳
                        </a>
                        で取引先を登録してください。
                      </>
                    )}
                  </p>
                </div>
              )}
              {selectedDirection === "incoming" && (
                <div>
                  <label className="block text-xs text-slate-600 mb-1">請求元（ドライバー）</label>
                  <CustomSelect
                    options={driverOptions}
                    value={createDriverId}
                    onChange={(v) => setCreateDriverId(v)}
                    placeholder="ドライバーを選択…"
                    clearable={false}
                    size="default"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                    ドライバーごとに当月の日報実績・固定経費・臨時経費を自動集計して下書きを作成します。
                  </p>
                </div>
              )}
            </div>
            <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
              <Button variant="ghost" size="sm" onClick={() => setShowCreatePicker(false)}>
                キャンセル
              </Button>
              {selectedDirection === "outgoing" ? (
                <Button asChild variant="default" size="sm" className={!createCounterpartyId ? "pointer-events-none opacity-50" : undefined}>
                  <a
                    href={`/admin/invoices/new?month=${encodeURIComponent(selectedMonth)}&kind=outgoing&direction=outgoing&section=${encodeURIComponent("ヤマト運輸")}&counterparty=${encodeURIComponent(createCounterpartyId)}`}
                    aria-disabled={!createCounterpartyId}
                  >
                    この取引先で作成
                  </a>
                </Button>
              ) : (
                <Button asChild variant="default" size="sm" className={!createDriverId ? "pointer-events-none opacity-50" : undefined}>
                  <a
                    href={`/admin/invoices/new?month=${encodeURIComponent(selectedMonth)}&kind=incoming&direction=incoming&section=${encodeURIComponent("郵便局")}&driver=${encodeURIComponent(createDriverId)}`}
                    aria-disabled={!createDriverId}
                  >
                    このドライバーで作成
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        onClose={() => setConfirmState(null)}
        confirmLabel="削除"
      />
    </AdminLayout>
  );
}
