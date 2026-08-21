"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotateLeft, faRotateRight, faCloud, faCloudArrowUp, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { invalidateApi } from "@/lib/swr";
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
  addrHtml,
} from "./editorModel";
import { printInvoice } from "./printInvoice";
import { type InvoiceKind } from "./invoiceKinds";

// WYSIWYG エディタ。帳票上で直接インライン編集（InvoiceSheet）。変更は自動保存し、
// 既存レコードを更新する（保存のたびに新規作成＝フォルダに増やさない）。Undo/Redo対応。

type AddressRow = { id: string; name: string; postal_code?: string; address?: string; phone?: string; invoice_no?: string };
type OrganizationSettings = {
  name: string; stampUrl: string | null;
  invoice_postal_code: string | null; invoice_address: string | null; invoice_tel: string | null;
  invoice_registration_no: string | null; invoice_bank_name: string | null;
  invoice_bank_no: string | null; invoice_bank_holder: string | null;
};
type DriverRow = {
  id: string; name: string; display_name?: string | null; status?: string;
  postal_code?: string | null; address?: string | null; phone?: string | null;
  bank_name?: string | null; bank_no?: string | null; bank_holder?: string | null;
};

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

  // 売上請求書の請求先が法人（取引先）かドライバー個人か。ドライバー宛は
  // 法人アドレス帳を経由せず、parties.toParty に "drv-<id>" を入れて表す。
  const [outgoingTarget, setOutgoingTarget] = useState<"corp" | "driver">(
    initial.kind === "outgoing" && initial.parties.toParty.startsWith("drv-") ? "driver" : "corp",
  );

  const { data: addrData } = useApi<{ addresses: AddressRow[] }>(
    st.kind === "outgoing" && outgoingTarget === "corp" ? "/api/admin/invoice-addresses" : null,
  );
  const { data: organizationData } = useApi<{ settings: OrganizationSettings }>(
    "/api/admin/organization-settings",
    { revalidateOnFocus: false },
  );
  const invoiceIssuer = organizationData?.settings
    ? { name: organizationData.settings.name, stampPath: organizationData.settings.stampUrl ?? "" }
    : undefined;
  const organizationAppliedRef = useRef(false);
  useEffect(() => {
    const org = organizationData?.settings;
    if (mode !== "new" || !org || organizationAppliedRef.current) return;
    organizationAppliedRef.current = true;
    const addressHtml = [org.invoice_postal_code ? `〒${org.invoice_postal_code}` : "", org.invoice_address ?? ""]
      .filter(Boolean).join("<br/>");
    setStRaw((prev) => prev.kind === "outgoing" ? {
      ...prev, fromName: org.name, fromAddrHtml: addressHtml, fromTel: org.invoice_tel ?? "",
      fromReg: org.invoice_registration_no ?? "", bankName: org.invoice_bank_name ?? "",
      bankNo: org.invoice_bank_no ?? "", bankHolder: org.invoice_bank_holder ?? "",
    } : {
      ...prev, toName: org.name, toAddrHtml: addressHtml, toTel: org.invoice_tel ?? "",
      toReg: org.invoice_registration_no ?? "",
    });
  }, [mode, organizationData]);
  const addresses = addrData?.addresses ?? [];
  // status=all: 稼働終了(inactive)済みのドライバーも選べるようにする
  // （過去に遡って請求書を作成するケースがあるため）。
  // all=1: ページングなしの全件（limit はサーバで100にクランプされ、101人目以降が
  // セレクトから黙って欠けるため使わない）。
  const needDrivers = st.kind === "incoming" || outgoingTarget === "driver";
  const { data: driverData } = useApi<{ drivers: DriverRow[] }>(
    needDrivers ? "/api/admin/users?all=1&status=all" : null,
  );
  const drivers = driverData?.drivers ?? [];

  const changeKind = (kind: InvoiceKind) => {
    setOutgoingTarget("corp");
    setSt((prev) => {
      const base = blankEditorState(kind);
      return {
        ...prev,
        kind,
        showStamp: base.showStamp,
        toName: base.toName,
        fromName: base.fromName,
        honorific: base.honorific,
        counterpartyInvoiceAddressId: null,
        parties: base.parties,
      };
    });
  };

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

  // 電話・登録番号を請求書に出すようにしたのは 2026-08-18。それ以前に作った請求書の
  // payload には両方入っていないので、取引先の登録値から**空欄だけ**埋める
  // （利用者が意図的に消した値を上書きしないよう、空のときしか触らない）。
  useEffect(() => {
    if (st.kind !== "outgoing" || !st.counterpartyInvoiceAddressId) return;
    if (st.toTel.trim() && st.toReg.trim()) return;
    const a = addresses.find((x) => x.id === st.counterpartyInvoiceAddressId);
    if (!a) return;
    const tel = a.phone ?? "";
    const reg = a.invoice_no ?? "";
    if ((!st.toTel.trim() && tel) || (!st.toReg.trim() && reg)) {
      setStRaw((prev) => ({
        ...prev,
        toTel: prev.toTel.trim() ? prev.toTel : tel,
        toReg: prev.toReg.trim() ? prev.toReg : reg,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, st.counterpartyInvoiceAddressId, st.toTel, st.toReg, st.kind]);

  /** 売上請求書の請求先にドライバー個人を選ぶ（自社 → ドライバー）。 */
  const selectRecipientDriver = (id: string) => {
    const d = drivers.find((x) => x.id === id);
    setSt((prev) => ({
      ...prev,
      // 法人アドレス帳の取引先ではないため紐付けは持たない
      counterpartyInvoiceAddressId: null,
      toName: d ? d.name : prev.toName,
      toAddrHtml: d ? addrHtml(d.postal_code, d.address) : prev.toAddrHtml,
      toTel: d ? d.phone ?? "" : prev.toTel,
      toReg: "",
      honorific: "様",
      parties: { ...prev.parties, toParty: id ? `drv-${id}` : prev.parties.toParty },
    }));
  };

  // 作成ピッカーからの遷移では toParty（drv-<id>）だけが入る。ドライバー取得後に名称等を補完。
  useEffect(() => {
    if (st.kind !== "outgoing" || outgoingTarget !== "driver") return;
    if (!st.parties.toParty.startsWith("drv-") || st.toName.trim()) return;
    const id = st.parties.toParty.slice("drv-".length);
    if (drivers.some((x) => x.id === id)) selectRecipientDriver(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, st.parties.toParty, st.toName, st.kind, outgoingTarget]);

  /** 請求先の種別（取引先 / ドライバー）を切り替える。選択済みの請求先はクリアする。 */
  const changeOutgoingTarget = (target: "corp" | "driver") => {
    if (target === outgoingTarget) return;
    setOutgoingTarget(target);
    setSt((prev) => ({
      ...prev,
      counterpartyInvoiceAddressId: null,
      toName: "",
      toAddrHtml: "",
      toTel: "",
      toReg: "",
      honorific: target === "driver" ? "様" : "御中",
      parties: { ...prev.parties, toParty: "" },
    }));
  };

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

  // 保存中に来た変更を取りこぼさないための予約フラグ。
  // （以前は保存中の呼び出しを捨てていたため、最後の編集が保存されないことがあった）
  const pendingRef = useRef(false);
  // persist 内から最新の自分自身を呼ぶための ref（下で毎レンダー更新する）
  const persistRef = useRef<(state: EditorState) => Promise<void>>(async () => {});

  const persist = useCallback(async (state: EditorState) => {
    if (savingRef.current) {
      pendingRef.current = true; // 進行中の保存が終わったら、その時点の最新でもう一度保存する
      return;
    }
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
      // 一覧・プレビューの SWR キャッシュを再取得させる。
      // これを怠ると、新規作成した請求書が一覧に出てこない／編集後に
      // 一覧が旧値のまま、という状態になる。待たない。
      //
      // ★対象は一覧キー（?month=… / ?months=1）だけに絞る。
      //   接頭辞一致なので "/api/admin/invoices" だと詳細キー
      //   "/api/admin/invoices/<id>"＝今まさに編集中の請求書まで巻き込み、
      //   自動保存のたびに自分の元データを取り直すことになる（無駄な上に事故のもと）。
      void invalidateApi("/api/admin/invoices?");
    } catch (e) {
      setSaveStatus("error");
      setError(e instanceof Error ? e.message : "自動保存に失敗しました");
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void persistRef.current(stRef.current);
      }
    }
  }, [savedId]);

  // st が変わったらデバウンスして自動保存。
  useEffect(() => {
    const t = setTimeout(() => { void persist(st); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [st, persist]);

  // アンマウント時（画面遷移など）にデバウンス中の保存が消えないよう、最後の状態を必ず1回保存する。
  // st/persist は毎レンダー更新される ref 経由で参照し、cleanup 自体は初回のみ登録する。
  persistRef.current = persist;
  useEffect(() => {
    return () => {
      void persistRef.current(stRef.current);
    };
  }, []);

  /** 未保存の変更があるか（デバウンス待ち・保存中を含む） */
  const hasUnsavedChanges = useCallback(
    () =>
      savingRef.current ||
      pendingRef.current ||
      JSON.stringify(saveBodyFromEditor({ ...stRef.current, id: savedId ?? stRef.current.id })) !==
        lastSavedBodyRef.current,
    [savedId],
  );

  // リロード・タブを閉じる・別サイトへ移動する操作は React のアンマウントを伴わないため、
  // デバウンス待ちの変更が失われる。未保存が残っているときだけブラウザ標準の確認を出す。
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

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

        {st.kind === "outgoing" && (
          <div className="w-36">
            <CustomSelect
              size="sm"
              clearable={false}
              value={outgoingTarget}
              onChange={(v) => changeOutgoingTarget(v === "driver" ? "driver" : "corp")}
              options={[
                { value: "corp", label: "取引先へ請求" },
                { value: "driver", label: "ドライバーへ請求" },
              ]}
            />
          </div>
        )}

        <div className="w-60">
          {st.kind === "outgoing" ? (
            outgoingTarget === "corp" ? (
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
                placeholder="請求先（ドライバー）を選択…"
                value={st.parties.toParty.startsWith("drv-") ? st.parties.toParty.slice(4) : ""}
                onChange={(v) => selectRecipientDriver(v)}
                options={drivers.map((d) => ({
                  value: d.id,
                  label: (d.display_name || d.name) + (d.status === "inactive" ? "（稼働終了）" : ""),
                }))}
              />
            )
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
        <label
          className="flex items-center gap-1.5 text-sm text-slate-700"
          title="この請求書に消費税を課すか（OFF＝免税・税額0）。税率は税抜⇔税込の換算にも使われます。"
        >
          <input type="checkbox" className="h-4 w-4 accent-slate-700" checked={st.taxEnabled} onChange={(e) => setSt((p) => ({ ...p, taxEnabled: e.target.checked }))} />
          消費税
          <input className="w-12 rounded border border-slate-300 px-2 py-1 text-sm text-right disabled:bg-slate-100 disabled:text-slate-400" value={st.taxRatePercent} inputMode="decimal" disabled={!st.taxEnabled} onChange={(e) => setSt((p) => ({ ...p, taxRatePercent: e.target.value }))} />%
        </label>

        {/* 帳票全体の表示基準。行ごとの入力(税抜/税込)と異なる行は自動換算して表示する。
            取引先送付用と税務提出用を、同じ請求書のまま切り替えて確認・印刷できる。 */}
        <div
          className="flex items-center gap-1.5"
          title={
            "帳票をどちらの基準で並べるかの切替（金額の中身は同じ請求書のまま）。\n" +
            "・税抜: 単価・合計を税抜で並べ、消費税を別行で加算\n" +
            "・税込: 単価・合計を税込で並べ、内訳として税額を表示\n" +
            "行ごとの「抜/込」（単価をどちらで入力したか）は、ここで選んだ基準へ自動換算されます。"
          }
        >
          <span className="text-sm text-slate-600">表示</span>
          <div className="inline-flex rounded border border-slate-300 overflow-hidden text-xs">
            {(
              [
                { key: "exclusive" as const, label: "税抜（税務提出用）" },
                { key: "inclusive" as const, label: "税込（取引先送付用）" },
              ]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSt((p) => ({ ...p, displayBasis: key }))}
                className={
                  "px-2.5 py-1.5 " +
                  (st.displayBasis === key ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50") +
                  (key === "inclusive" ? " border-l border-slate-300" : "")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

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
          {/* 印刷の前に保存を確定させる（印刷ダイアログをキャンセルしても変更が残るように） */}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await persist(stRef.current);
              printInvoice(invoiceFileName(stRef.current));
            }}
          >
            印刷（PDF保存）
          </Button>
        </div>
      </div>

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
        <PaginatedInvoiceSheet state={st} onChange={setSt} sheetRef={sheetRef} issuer={invoiceIssuer} />
      </div>
    </div>
  );
}
