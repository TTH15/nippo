"use client";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faArrowLeft,
  faFileLines,
  faMagnifyingGlass,
} from "@fortawesome/free-solid-svg-icons";
import { format } from "date-fns";
import { Button } from "@/lib/ui/button";
import { DatePicker } from "@/lib/components/DatePicker";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { FormUIProvider } from "./context";
import FormBuilder from "./FormBuilder";
import { FormManagement } from "./FormManagement";
import RecordEditor, { type RecordSave } from "./RecordEditor";
import { RecordListCard } from "./RecordListCard";
import { Choice, control } from "./Fields";
import {
  makeTemplate,
  displayValue,
  recordTitle,
  RESPONSE_STATUSES,
  type RecordForm,
  type RecordEntry,
  type FormGrant,
  type FormRole,
  type MemberOption,
} from "./model";
import { useUnsavedChanges } from "./useUnsavedChanges";

type Bootstrap = {
  actor: { id: string; name: string };
  canConfigure: boolean;
  forms: RecordForm[];
  grants: Record<string, FormGrant>;
  roles: FormRole[];
  members: MemberOption[];
};
export default function RecordFormsApp({
  management = false,
  self = false,
}: {
  management?: boolean;
  self?: boolean;
}) {
  const scope = management ? "manage" : self ? "self" : "staff";
  const base = `/api/record-forms?scope=${scope}`;
  const {
    data: boot,
    error: loadError,
    refresh,
  } = useApi<Bootstrap>(base, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
  const [selected, setSelected] = useState("");
  const [builder, setBuilder] = useState<RecordForm | null>(null);
  const [templates, setTemplates] = useState(false);
  const [editor, setEditor] = useState<{
    record: RecordEntry | null;
    editable: boolean;
    form: RecordForm;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  useUnsavedChanges(dirty);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const form = boot?.forms.find((f) => f.id === selected) ?? boot?.forms[0];
  const params = new URLSearchParams({
    scope,
    q: search,
    status,
    from,
    to,
    page: String(page),
  });
  const listKey =
    !management && form && !editor
      ? `/api/record-forms/${form.id}/records?${params}`
      : null;
  const {
    data: list,
    error: listError,
    refresh: refreshList,
  } = useApi<{ records: RecordEntry[]; hasMore: boolean }>(listKey, {
    keepPreviousData: false,
    shouldRetryOnError: false,
  });
  const resetFilters = () => {
    setQuery("");
    setSearch("");
    setStatus("");
    setFrom("");
    setTo("");
    setPage(1);
  };
  const close = () => {
    setEditor(null);
    setBuilder(null);
    setTemplates(false);
    setDirty(false);
  };
  const apply = async (next: RecordForm) => {
    const existing = boot?.forms.find((f) => f.id === next.id);
    await apiFetch(
      `/api/record-forms${existing ? `/${next.id}` : ""}?scope=manage`,
      {
        method: existing ? "PUT" : "POST",
        body: JSON.stringify({
          form: next,
          expectedVersion: existing?.version,
        }),
      },
    );
    close();
    setNotice(existing ? "設定を更新しました" : "フォームを作成しました");
    await refresh();
  };
  const save = async (payload: RecordSave) => {
    await apiFetch(
      `/api/record-forms/${editor!.form.id}/records${editor?.record ? `/${payload.id}` : ""}?scope=${scope}`,
      {
        method: editor?.record ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    close();
    setNotice("保存しました");
    await refresh();
    await refreshList();
  };
  const open = async (id: string) => {
    if (opening) return;
    setOpening(true);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<{ record: RecordEntry; editable: boolean }>(
        `/api/record-forms/${form!.id}/records/${id}?scope=${scope}`,
      );
      setEditor({ ...result, form: form! });
    } catch (e) {
      setError(e instanceof Error ? e.message : "記録を開けませんでした");
    } finally {
      setOpening(false);
    }
  };
  if (loadError && !boot)
    return (
      <div role="alert" className="p-6 text-sm text-red-700">
        {loadError.message}
        <Button
          variant="outline"
          className="ml-3"
          onClick={() => void refresh()}
        >
          再試行
        </Button>
      </div>
    );
  if (!boot)
    return (
      <p role="status" className="p-6 text-sm text-slate-500">
        読み込み中…
      </p>
    );
  const grant = form ? boot.grants[form.id] : undefined;
  const createTemplate = (kind: "case" | "payment" | "memo") => {
    const draft = makeTemplate(kind, crypto.randomUUID());
    draft.access = Object.fromEntries(
      boot.roles.map((r) => [r.id, r.manager ? "edit" : "none"]),
    );
    draft.driver = {
      submit: false,
      readOwn: false,
      editOwn: false,
      readSubject: false,
    };
    setBuilder(draft);
    setTemplates(false);
  };
  return (
    <FormUIProvider
      value={{ members: boot.members, roles: boot.roles, preview: false }}
    >
      <main className="mx-auto max-w-[1400px] space-y-6 p-4 pb-20 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">
            {management
              ? builder
                ? `${builder.name}の設定`
                : "フォーム管理"
              : "記録・報告"}
          </h1>
          {management && !builder && !templates && (
            <Button
              size="touch"
              onClick={() => {
                setTemplates(true);
                setNotice("");
              }}
            >
              <FontAwesomeIcon icon={faPlus} />
              フォームを追加
            </Button>
          )}
        </header>
        {notice && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        {management ? (
          builder ? (
            <FormBuilder
              key={builder.id}
              form={builder}
              existingCount={0}
              isNew={!boot.forms.some((f) => f.id === builder.id)}
              onDirtyChange={setDirty}
              onClose={close}
              onApply={apply}
            />
          ) : templates ? (
            <section className="space-y-5">
              <Button variant="ghost" onClick={close}>
                <FontAwesomeIcon icon={faArrowLeft} />
                フォーム一覧に戻る
              </Button>
              <div className="grid gap-4 md:grid-cols-3">
                {(
                  [
                    {
                      id: "case",
                      title: "案件報告",
                      text: "対象者・発生日・経緯・再発防止策",
                    },
                    {
                      id: "payment",
                      title: "日払い記録",
                      text: "支払先・支払日・稼働日・金額・方法",
                    },
                    {
                      id: "memo",
                      title: "シンプルなメモ",
                      text: "件名・日付・本文",
                    },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    className="rounded-xl border border-slate-200 bg-white p-6 text-left hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-amber-400"
                    onClick={() => createTemplate(t.id)}
                  >
                    <FontAwesomeIcon
                      icon={faFileLines}
                      className="mb-4 size-6 text-slate-400"
                    />
                    <h2 className="font-semibold">{t.title}</h2>
                    <p className="mt-2 text-sm text-slate-500">{t.text}</p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                新しいフォームは管理者だけが使える状態で作成します。
              </p>
            </section>
          ) : (
            <>
              <FormManagement
                forms={boot.forms}
                onConfigure={(f) => {
                  setBuilder(f);
                  setNotice("");
                }}
              />
              {!boot.forms.length && (
                <p className="text-sm text-slate-500">
                  フォームを追加して、入力項目を設定してください。
                </p>
              )}
            </>
          )
        ) : editor && form ? (
          <RecordEditor
            key={editor.record?.id ?? "new"}
            form={editor.form}
            record={editor.record}
            actor={boot.actor}
            self={self}
            editable={editor.editable}
            onSave={save}
            onClose={close}
            onDirtyChange={setDirty}
          />
        ) : (
          <>
            <div
              className="flex flex-wrap gap-1 border-b border-slate-200"
              role="tablist"
              aria-label="記録の種類"
            >
              {boot.forms.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={f.id === form?.id}
                  onClick={() => {
                    setSelected(f.id);
                    resetFilters();
                    setNotice("");
                  }}
                  className={`border-b-2 px-4 py-3 text-sm font-semibold ${f.id === form?.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500"}`}
                >
                  {f.name}
                </button>
              ))}
            </div>
            {!form ? (
              <p className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
                利用できるフォームはありません。
                {boot.canConfigure &&
                  !self &&
                  "「フォーム管理」から作成できます。"}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{form.name}の一覧</h2>
                  {grant?.create && (
                    <Button
                      size="touch"
                      onClick={() => {
                        setEditor({ record: null, editable: true, form });
                        setNotice("");
                      }}
                    >
                      <FontAwesomeIcon icon={faPlus} />
                      {self ? "報告する" : "記録を追加"}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="relative min-w-[180px] flex-1">
                    <FontAwesomeIcon
                      icon={faMagnifyingGlass}
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      className={`${control} !pl-10`}
                      aria-label="記録を検索"
                      placeholder="記録を検索"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  {(form.statuses.length > 0 ||
                    !!status ||
                    list?.records.some((record) => !!record.status)) && (
                    <div className="w-40">
                      <Choice
                        label="対応状況で絞り込み"
                        value={status}
                        onChange={(s) => {
                          setStatus(s);
                          setPage(1);
                        }}
                        options={[
                          { value: "", label: "すべて" },
                          ...RESPONSE_STATUSES.map((s) => ({
                            value: s.id,
                            label: s.label,
                          })),
                        ]}
                      />
                    </div>
                  )}
                  {form.dateField && (
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <DatePicker
                        ariaLabel="開始日"
                        placeholder="開始日"
                        displayFormat="yyyy/MM/dd"
                        className="h-11 min-w-0 flex-1 rounded-lg sm:w-36 sm:flex-none"
                        value={from ? new Date(`${from}T00:00:00`) : undefined}
                        toDate={to ? new Date(`${to}T00:00:00`) : undefined}
                        onChange={(d) => {
                          setFrom(d ? format(d, "yyyy-MM-dd") : "");
                          setPage(1);
                        }}
                      />
                      <span className="text-slate-400">〜</span>
                      <DatePicker
                        ariaLabel="終了日"
                        placeholder="終了日"
                        displayFormat="yyyy/MM/dd"
                        className="h-11 min-w-0 flex-1 rounded-lg sm:w-36 sm:flex-none"
                        value={to ? new Date(`${to}T00:00:00`) : undefined}
                        fromDate={
                          from ? new Date(`${from}T00:00:00`) : undefined
                        }
                        onChange={(d) => {
                          setTo(d ? format(d, "yyyy-MM-dd") : "");
                          setPage(1);
                        }}
                      />
                    </div>
                  )}
                  {(query || status || from || to) && (
                    <Button variant="ghost" onClick={resetFilters}>
                      クリア
                    </Button>
                  )}
                </div>
                {listError ? (
                  <p role="alert" className="text-sm text-red-700">
                    {listError.message}
                  </p>
                ) : !list ? (
                  <p role="status" className="text-sm text-slate-500">
                    読み込み中…
                  </p>
                ) : (
                  <>
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {list.records.length === 0 ? (
                        <p className="p-8 text-center text-sm text-slate-500">
                          該当する記録はありません
                        </p>
                      ) : (
                        list.records.map((r) => (
                          <RecordListCard
                            key={r.id}
                            title={recordTitle(r)}
                            items={form.fields
                              .filter(
                                (f) => f.inList && f.id !== form.titleField,
                              )
                              .map((f) => ({
                                id: f.id,
                                label: f.label,
                                value: displayValue(
                                  r.schema.fields.find((x) => x.id === f.id) ??
                                    f,
                                  r.answers[f.id],
                                  Object.entries(r.memberNames ?? {}).map(
                                    ([value, label]) => ({ value, label }),
                                  ),
                                ),
                              }))}
                            status={r.schema.statuses.find(
                              (s) => s.id === r.status,
                            )}
                            onOpen={() => void open(r.id)}
                          />
                        ))
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        前のページ
                      </Button>
                      <span className="text-xs text-slate-500">
                        {page}ページ
                      </span>
                      <Button
                        variant="outline"
                        disabled={!list.hasMore}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        次のページ
                      </Button>
                    </div>
                  </>
                )}
                {opening && (
                  <p role="status" className="text-sm text-slate-500">
                    記録を開いています…
                  </p>
                )}
              </>
            )}
          </>
        )}
      </main>
    </FormUIProvider>
  );
}
