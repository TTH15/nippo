"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFolder, faFileInvoice, faPenToSquare, faPlus, faTrashCan, faEye, faArrowsRotate } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

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
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCreatePicker, setShowCreatePicker] = useState(false);
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
  const [drivers, setDrivers] = useState<DriverFolder[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

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
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch<{ invoices: SavedInvoice[] }>(
        `/api/admin/invoices`,
      );
      setInvoices(res.invoices ?? []);
    } catch (e) {
      console.error(e);
      setErrorMessage("請求書一覧の取得に失敗しました。migration未適用やDBエラーの可能性があります。");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    try {
      const all: DriverFolder[] = [];
      let cursor: string | null = "0";
      while (cursor !== null) {
        const res: { drivers: DriverFolder[]; nextCursor: string | null } = await apiFetch(
          `/api/admin/users?limit=100&cursor=${encodeURIComponent(cursor)}`
        );
        all.push(...(res.drivers ?? []));
        cursor = res.nextCursor;
      }
      setDrivers(all);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadDrivers();
  }, [load, loadDrivers]);

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
      await load();
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
    } catch (e) {
      console.error(e);
      setErrorMessage("ステータス更新に失敗しました。");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const deleteInvoice = async (invoiceId: string) => {
    if (!canWrite) return;
    if (!window.confirm("この請求書を削除しますか？")) return;
    setDeletingId(invoiceId);
    try {
      await apiFetch(`/api/admin/invoices/${encodeURIComponent(invoiceId)}`, {
        method: "DELETE",
      });
      setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId));
    } catch (e) {
      console.error(e);
      setErrorMessage("請求書の削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">請求書一覧</h1>
            <p className="text-sm text-slate-500 mt-0.5">登録済みの請求データから請求書を作成・管理</p>
            <p className="text-xs text-slate-400 mt-1">
              <a href="/admin/counterparties" className="underline hover:text-slate-600">
                取引先
              </a>
              からコース単位の集計を見ながら、ワンクリックで下書きを開けます。
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowCreatePicker(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              保存先を選んで作成
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="mb-4 px-3 py-2 text-sm rounded border border-amber-200 bg-amber-50 text-amber-800">
            {errorMessage}
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 text-xs text-slate-600">
            保存済み請求書はスナップショット固定です。売上ログ変更後は「再作成」から最新内容で作り直してください。
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[160px_180px_240px_1fr]">
            <div className="border-r border-slate-200 min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">年月</div>
              <div className="p-2 space-y-1">
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
                      className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                        selectedMonth === m ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <FontAwesomeIcon icon={faFolder} className="mr-2 text-slate-400" />
                      {m}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="border-r border-slate-200 min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">請求方向</div>
              <div className="p-2 space-y-1">
                {loading ? (
                  [...Array(2)].map((_, i) => (
                    <div key={`dir-skel-${i}`} className="h-8 rounded bg-slate-100 animate-pulse" />
                  ))
                ) : (directionFolders.length === 0 ? (["outgoing", "incoming"] as const) : directionFolders).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setSelectedDirection(dir)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                      selectedDirection === dir ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <FontAwesomeIcon icon={faFolder} className="mr-2 text-slate-400" />
                    {dir === "outgoing" ? "自社が請求" : "自社に請求"}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-r border-slate-200 min-h-[520px]">
              <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">取引先</div>
              <div className="p-2 space-y-1">
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
                      className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                        selectedCounterparty === name ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
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
            <div className="min-h-[520px] max-h-[520px] overflow-y-auto">
            <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
              {canWrite && selectedDirection === "incoming" && selectedDriver && (
                <div className="p-3 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
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
              <div className="flex gap-1 p-3 bg-slate-50/70">
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
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      filter === f.key
                        ? "bg-slate-800 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm table-fixed">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
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
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    読み込み中...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    該当する請求書はありません
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const s = statusLabel[inv.status];
                  return (
                    <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 font-mono text-slate-700 break-all">
                        <div>{inv.invoiceNo || inv.id}</div>
                        <span className="mt-1 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          スナップショット固定
                        </span>
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
                          <select
                            value={inv.status}
                            disabled={updatingStatusId === inv.id}
                            onChange={(e) => void updateStatus(inv.id, e.target.value as SavedInvoice["status"])}
                            className={`px-2 py-1 rounded text-xs font-medium border border-slate-200 ${s.cls}`}
                          >
                            <option value="draft">下書き</option>
                            <option value="pending_approval">承認待ち</option>
                            <option value="approved">承認済</option>
                            <option value="paid">入金済</option>
                          </select>
                        ) : (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
                            {s.text}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {canWrite ? (
                          (() => {
                            const href = `/admin/invoices/new?invoiceId=${encodeURIComponent(inv.id)}`;
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
                                {inv.month && inv.section ? (
                                  <a
                                    href={`/admin/invoices/new?month=${encodeURIComponent(inv.month)}&section=${encodeURIComponent(inv.section)}${
                                      inv.counterpartyInvoiceAddressId
                                        ? `&counterparty=${encodeURIComponent(inv.counterpartyInvoiceAddressId)}`
                                        : ""
                                    }`}
                                    title="再作成"
                                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-amber-200 text-amber-600 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                                  >
                                    <FontAwesomeIcon icon={faArrowsRotate} className="w-3.5 h-3.5" />
                                  </a>
                                ) : null}
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
            </div>
          </div>
        </div>
      </div>

      {showCreatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white border border-slate-200 p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-3">保存先フォルダを選択</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">対象月フォルダ</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">請求方向フォルダ</label>
                <select
                  value={selectedDirection}
                  onChange={(e) => setSelectedDirection(e.target.value as "outgoing" | "incoming")}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                >
                  <option value="outgoing">自社が請求</option>
                  <option value="incoming">自社に請求</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowCreatePicker(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
              >
                キャンセル
              </button>
              <a
                href={`/admin/invoices/new?month=${encodeURIComponent(selectedMonth)}&direction=${encodeURIComponent(selectedDirection)}&section=${encodeURIComponent(selectedDirection === "incoming" ? "郵便局" : "ヤマト運輸")}`}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700"
              >
                この保存先で作成
              </a>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
