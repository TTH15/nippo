"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotateLeft, faRotateRight, faCloud, faCloudArrowUp, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { DatePicker } from "@/lib/components/DatePicker";
import { Button } from "@/lib/ui/button";
import { PaginatedInvoiceSheet } from "./PaginatedInvoiceSheet";
import {
  type EditorState,
  blankEditorState,
  saveBodyFromEditor,
  parsePeriodJa,
  formatPeriodJa,
  parseIsoDate,
  toIsoDate,
  invoiceFileName,
} from "./editorModel";
import { printInvoice } from "./printInvoice";
import { type InvoiceKind } from "./invoiceKinds";

// WYSIWYG エディタ。帳票上で直接インライン編集（InvoiceSheet）。変更は自動保存し、
// 既存レコードを更新する（保存のたびに新規作成＝フォルダに増やさない）。Undo/Redo対応。

type PairedInfo = {
  id: string;
  invoiceNo: string;
  amount: number;
  variant: "client_inclusive" | "tax_exclusive" | null;
  mainQtyTotal: number;
  deductQtyTotal: number;
  lineCount: number;
};
type AddressRow = { id: string; name: string; postal_code?: string; address?: string; phone?: string; invoice_no?: string };
type DriverRow = {
  id: string; name: string; display_name?: string | null; status?: string;
  postal_code?: string | null; address?: string | null; phone?: string | null;
  bank_name?: string | null; bank_no?: string | null; bank_holder?: string | null;
};

function addrHtml(postal?: string | null, address?: string | null): string {
  const p = postal ?? ""; const a = address ?? "";
  if (!p && !a) return "";
  return p ? `〒${p}<br/>${a}` : a;
}

const HISTORY_COALESCE_MS = 500; // 連続入力はこの間隔でまとめて1ステップにする
const AUTOSAVE_DEBOUNCE_MS = 1200;

export function InvoiceSheetEditor({ initial, mode }: { initial: EditorState; mode: "new" | "edit" }) {
  const [st, setStRaw] = useState<EditorState>(initial);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // ── Undo/Redo 履歴 ──
  const [past, setPast] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const stRef = useRef(st);
  stRef.current = st;
  const lastSnapRef = useRef(0);

  // 履歴を考慮した setState。連続入力は HISTORY_COALESCE_MS でまとめる。
  const setSt = useCallback((updater: SetStateAction<EditorState>) => {
    const now = Date.now();
    if (now - lastSnapRef.current > HISTORY_COALESCE_MS) {
      setPast((p) => [...p.slice(-99), stRef.current]);
      setFuture([]);
      lastSnapRef.current = now;
    }
    setStRaw(updater);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, stRef.current]);
      setStRaw(prev);
      lastSnapRef.current = 0;
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p, stRef.current]);
      setStRaw(next);
      lastSnapRef.current = 0;
      return f.slice(0, -1);
    });
  }, []);

  // Cmd/Ctrl+Z = 戻る / Cmd/Ctrl+Shift+Z（または Ctrl+Y）= やり直し
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (meta && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const period = parsePeriodJa(st.period);
  const setPeriod = (start?: Date, end?: Date) =>
    setSt((p) => ({ ...p, period: formatPeriodJa(start, end) }));

  const { data: addrData } = useApi<{ addresses: AddressRow[] }>(
    st.kind === "outgoing" ? "/api/admin/invoice-addresses" : null,
  );
  const addresses = addrData?.addresses ?? [];
  // status=all: 稼働終了(inactive)済みのドライバーも選べるようにする
  // （過去に遡って請求書を作成するケースがあるため）。
  const { data: driverData } = useApi<{ drivers: DriverRow[] }>(
    st.kind === "incoming" ? "/api/admin/users?limit=500&status=all" : null,
  );
  const drivers = driverData?.drivers ?? [];

  const changeKind = (kind: InvoiceKind) =>
    setSt((prev) => {
      const base = blankEditorState(kind);
      return { ...prev, kind, showStamp: base.showStamp, toName: base.toName, fromName: base.fromName, parties: base.parties };
    });

  const selectCounterparty = (id: string) => {
    const a = addresses.find((x) => x.id === id);
    setSt((prev) => ({
      ...prev,
      counterpartyInvoiceAddressId: id || null,
      toName: a ? a.name : prev.toName,
      toAddrHtml: a ? addrHtml(a.postal_code, a.address) : prev.toAddrHtml,
      toTel: a ? a.phone ?? "" : prev.toTel,
      toReg: a ? a.invoice_no ?? "" : prev.toReg,
      parties: { ...prev.parties, toParty: id ? `corp-${id}` : prev.parties.toParty },
    }));
  };

  // 取引先指定の下書きでは counterpartyInvoiceAddressId のみ入る。アドレス取得後に名称等を補完。
  useEffect(() => {
    if (st.kind !== "outgoing") return;
    if (!st.counterpartyInvoiceAddressId || st.toName.trim()) return;
    const a = addresses.find((x) => x.id === st.counterpartyInvoiceAddressId);
    if (a) selectCounterparty(a.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, st.counterpartyInvoiceAddressId, st.toName, st.kind]);

  const selectDriver = (id: string) => {
    const d = drivers.find((x) => x.id === id);
    setSt((prev) => ({
      ...prev,
      fromName: d ? d.name : prev.fromName,
      fromAddrHtml: d ? addrHtml(d.postal_code, d.address) : prev.fromAddrHtml,
      fromTel: d ? d.phone ?? "" : prev.fromTel,
      bankName: d ? d.bank_name ?? "" : prev.bankName,
      bankNo: d ? d.bank_no ?? "" : prev.bankNo,
      bankHolder: d ? d.bank_holder ?? "" : prev.bankHolder,
      parties: { ...prev.parties, fromParty: id ? `drv-${id}` : prev.parties.fromParty },
    }));
  };

  // ── 自動保存（同一レコードを更新。初回のみ作成し、以降はPATCH） ──
  const [savedId, setSavedId] = useState<string | undefined>(initial.id);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedBodyRef = useRef<string>(JSON.stringify(saveBodyFromEditor(initial)));
  const savingRef = useRef(false);

  const persist = useCallback(async (state: EditorState) => {
    if (savingRef.current) return;
    const id = savedId ?? state.id;
    const body = saveBodyFromEditor({ ...state, id });
    const serialized = JSON.stringify(body);
    if (serialized === lastSavedBodyRef.current) return; // 変更なし
    savingRef.current = true;
    setSaveStatus("saving");
    setError(null);
    try {
      const isUpdate = Boolean(id);
      const url = isUpdate ? `/api/admin/invoices/${encodeURIComponent(id as string)}` : "/api/admin/invoices";
      const res = (await apiFetch(url, { method: isUpdate ? "PATCH" : "POST", body: serialized })) as {
        invoice?: { id?: string };
        id?: string;
      };
      const newId = res?.invoice?.id ?? res?.id ?? id;
      lastSavedBodyRef.current = JSON.stringify(saveBodyFromEditor({ ...state, id: newId }));
      if (!isUpdate && newId) {
        setSavedId(newId);
        setStRaw((p) => ({ ...p, id: newId }));
        // リロード時に同一レコードを編集できるよう URL を差し替え（再マウントは伴わない）。
        window.history.replaceState(null, "", `/admin/invoices/${encodeURIComponent(newId)}/edit`);
      }
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      setError(e instanceof Error ? e.message : "自動保存に失敗しました");
    } finally {
      savingRef.current = false;
    }
  }, [savedId]);

  // st が変わったらデバウンスして自動保存。
  useEffect(() => {
    const t = setTimeout(() => { void persist(st); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [st, persist]);

  // アンマウント時（画面遷移など）にデバウンス中の保存が消えないよう、最後の状態を必ず1回保存する。
  // st/persist は毎レンダー更新される ref 経由で参照し、cleanup 自体は初回のみ登録する。
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    return () => {
      void persistRef.current(stRef.current);
    };
  }, []);

  // 「一覧」へ戻る前にも同様に保存を確定させてから遷移する（デバウンス待ちで消えるのを防ぐ）。
  const goToList = async (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await persist(stRef.current);
    window.location.href = "/admin/invoices";
  };

  const saveStatusUi = (() => {
    if (saveStatus === "saving") return { icon: faCloudArrowUp, text: "保存中…", cls: "text-slate-500" };
    if (saveStatus === "error") return { icon: faTriangleExclamation, text: "保存エラー", cls: "text-red-600" };
    if (saveStatus === "saved") return { icon: faCloud, text: "自動保存済み", cls: "text-emerald-600" };
    return { icon: faCloud, text: "自動保存", cls: "text-slate-400" };
  })();

  // ── 税込/税抜ペア（取引先送付用⇔税務提出用）。保存済みの請求書のみ対象。 ──
  const pairKey = savedId ? `/api/admin/invoices/${encodeURIComponent(savedId)}/pair` : null;
  const { data: pairData, refresh: refreshPair } = useApi<{ paired: PairedInfo | null }>(pairKey);
  const paired = pairData?.paired ?? null;
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const createPair = async () => {
    if (!savedId || pairBusy) return;
    setPairBusy(true);
    setPairError(null);
    try {
      await persist(stRef.current); // 変換元の未保存分をまず確定させる
      const res = await apiFetch<{ pairedInvoiceId: string }>(
        `/api/admin/invoices/${encodeURIComponent(savedId)}/pair`,
        { method: "POST" },
      );
      await refreshPair();
      window.open(`/admin/invoices/${res.pairedInvoiceId}/edit`, "_blank");
    } catch (e) {
      setPairError(e instanceof Error ? e.message : "ペアの作成に失敗しました");
    } finally {
      setPairBusy(false);
    }
  };

  const myMainQtyTotal = st.main.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const myDeductQtyTotal = st.deduct.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const qtyMatches = paired ? myMainQtyTotal === paired.mainQtyTotal && myDeductQtyTotal === paired.deductQtyTotal : null;
  const pairedVariantLabel = (v: PairedInfo["variant"]) =>
    v === "tax_exclusive" ? "税抜・税務提出用" : v === "client_inclusive" ? "税込・取引先送付用" : "";

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* スリムなツールバー（PDFには含めない） */}
      <div className="hide-print flex flex-wrap items-center gap-3 px-4 py-2 bg-white border-b border-slate-200">
        <a href="/admin/invoices" onClick={goToList} className="text-sm text-slate-600 underline hover:text-slate-900">一覧</a>

        <div className="flex gap-1">
          {(["outgoing", "incoming"] as const).map((k) => (
            <button key={k} type="button" disabled={mode === "edit"} onClick={() => changeKind(k)}
              className={"rounded-lg px-3 py-1.5 text-sm border " + (st.kind === k ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50") + (mode === "edit" ? " opacity-60 cursor-not-allowed" : "")}>
              {k === "outgoing" ? "売上請求書" : "受領請求書"}
            </button>
          ))}
        </div>

        <div className="w-60">
          {st.kind === "outgoing" ? (
            <CustomSelect
              size="sm"
              placeholder="請求先（取引先）を選択…"
              value={st.counterpartyInvoiceAddressId ?? ""}
              onChange={(v) => selectCounterparty(v)}
              options={addresses.map((a) => ({ value: a.id, label: a.name }))}
            />
          ) : (
            <CustomSelect
              size="sm"
              placeholder="請求元（ドライバー）を選択…"
              value={st.parties.fromParty.startsWith("drv-") ? st.parties.fromParty.slice(4) : ""}
              onChange={(v) => selectDriver(v)}
              options={drivers.map((d) => ({
                value: d.id,
                label: (d.display_name || d.name) + (d.status === "inactive" ? "（稼働終了）" : ""),
              }))}
            />
          )}
        </div>

        {/* 消費税の ON/OFF と税率。OFF（免税事業者など）の請求書もここで再ONできる。 */}
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-slate-700" checked={st.taxEnabled} onChange={(e) => setSt((p) => ({ ...p, taxEnabled: e.target.checked }))} />
          消費税
          <input className="w-12 rounded border border-slate-300 px-2 py-1 text-sm text-right disabled:bg-slate-100 disabled:text-slate-400" value={st.taxRatePercent} inputMode="decimal" disabled={!st.taxEnabled} onChange={(e) => setSt((p) => ({ ...p, taxRatePercent: e.target.value }))} />%
        </label>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={undo} disabled={past.length === 0} title="戻る（⌘Z）">
            <FontAwesomeIcon icon={faRotateLeft} className="h-3.5 w-3.5" />戻る
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={future.length === 0} title="やり直し（⌘⇧Z）">
            <FontAwesomeIcon icon={faRotateRight} className="h-3.5 w-3.5" />やり直し
          </Button>
          <span className={`inline-flex items-center gap-1.5 px-1.5 text-xs ${saveStatusUi.cls}`} title={error ?? undefined}>
            <FontAwesomeIcon icon={saveStatusUi.icon} className="h-3.5 w-3.5" />
            {saveStatusUi.text}
          </span>
          <Button variant="outline" size="sm" onClick={() => printInvoice(invoiceFileName(st))}>印刷（PDF保存）</Button>
        </div>
      </div>

      {/* 税込/税抜ペア: 取引先送付用と税務提出用を2枚セットで保管・検算する */}
      {savedId && (
        <div className="hide-print flex flex-wrap items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm">
          {!paired ? (
            <>
              <span className="text-amber-800">
                取引先送付用（税込）と税務提出用（税抜）を2枚セットで保存できます。
              </span>
              <Button variant="outline" size="sm" onClick={createPair} disabled={pairBusy}>
                {pairBusy ? "作成中…" : "税込⇔税抜ペアを作成"}
              </Button>
              {pairError && <span className="text-red-600 text-xs">{pairError}</span>}
            </>
          ) : (
            <>
              <span className="font-medium text-amber-800">ペア: {pairedVariantLabel(paired.variant)}</span>
              <span className="text-slate-700">{paired.invoiceNo}　¥{paired.amount.toLocaleString("ja-JP")}</span>
              {qtyMatches === true ? (
                <span className="text-emerald-700">✅ 数量一致</span>
              ) : (
                <span className="text-red-600">
                  ⚠️ 数量不一致（このページ: 請求分{myMainQtyTotal} / 支払分{myDeductQtyTotal}、ペア: 請求分
                  {paired.mainQtyTotal} / 支払分{paired.deductQtyTotal}）
                </span>
              )}
              <a
                href={`/admin/invoices/${paired.id}/edit`}
                target="_blank"
                rel="noreferrer"
                className="text-slate-600 underline hover:text-slate-900"
              >
                ペアを開く
              </a>
            </>
          )}
        </div>
      )}

      {/* 日付ツールバー（対象期間・振込期日。帳票には文字列で反映） */}
      <div className="hide-print flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm">
        <span className="font-medium text-slate-600">対象期間</span>
        <DatePicker className="w-40 h-8" value={period.start} onChange={(d) => setPeriod(d, period.end)} placeholder="開始日" />
        <span className="text-slate-400">〜</span>
        <DatePicker className="w-40 h-8" value={period.end} onChange={(d) => setPeriod(period.start, d)} placeholder="終了日" />
        <span className="ml-3 font-medium text-slate-600">振込期日</span>
        <DatePicker className="w-40 h-8" value={parseIsoDate(st.dueDate)} onChange={(d) => setSt((p) => ({ ...p, dueDate: toIsoDate(d) }))} placeholder="未設定" />

        {/* 余白の微調整（mm）。1ページに収まらないときにここで詰められる。 */}
        <span className="ml-3 pl-3 border-l border-slate-300 font-medium text-slate-600">余白（mm）</span>
        {(
          [
            { key: "headerGapMm", label: "上部", title: "タイトル・宛先/自社ブロック下の余白" },
            { key: "summaryGapMm", label: "サマリー〜表", title: "サマリー表と請求分テーブルの間" },
            { key: "deductGapMm", label: "表と表の間", title: "請求分とお支払い分テーブルの間" },
          ] as const
        ).map(({ key, label, title }) => (
          <label key={key} className="flex items-center gap-1 text-slate-700" title={title}>
            {label}
            <input
              type="number"
              min={0}
              max={40}
              step={1}
              value={st.layout[key]}
              onChange={(e) => setSt((p) => ({ ...p, layout: { ...p.layout, [key]: Number(e.target.value) || 0 } }))}
              className="w-14 rounded border border-slate-300 px-1.5 py-1 text-sm text-right"
            />
          </label>
        ))}
      </div>

      {/* 帳票（直接インライン編集。実際の改ページ位置をライブに可視化） */}
      <div className="flex-1 overflow-auto">
        <PaginatedInvoiceSheet state={st} onChange={setSt} sheetRef={sheetRef} />
      </div>
    </div>
  );
}
