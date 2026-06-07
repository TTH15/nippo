"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { PostSubmitView } from "@/lib/components/PostSubmitView";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";
import { getDisplayName } from "@/lib/displayName";
import { CustomSelect } from "@/lib/components/CustomSelect";
import type { SubmitBlock, ResolvedBlock, BlockType, MetricField } from "@/lib/submitScreenBlocks";

type FieldRow = { id: string; field_key: string; label: string; group_label: string | null };
type UnitRow = { id: string; name: string; code: string | null; fields: FieldRow[] };
type CarrierRow = { id: string; name: string; units: UnitRow[] };
type DriverRow = { id: string; name: string; display_name: string | null };
type EventRow = { id: string; name: string; status: string; starts_on: string | null; ends_on: string | null };
type Config = {
  thanksTitle: string;
  thanksMessage: string;
  rankingSource: string;
  linkedEventId: string | null;
  metricLabel: string;
  metricFields: MetricField[];
  targetDriverIds: string[];
  teamRankingVisibleToDrivers: boolean;
  blocks: SubmitBlock[] | null;
};

const fkid = (unitId: string, fieldKey: string) => `${unitId}|${fieldKey}`;
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `b${Math.floor(performance.now())}`;

const BLOCK_LABEL: Record<BlockType, string> = {
  greeting: "あいさつ",
  today_reward: "今日の報酬",
  event_points: "イベント・チームポイント",
  personal_count: "個人の個数",
  personal_ranking: "個人ランキング",
};

// blocks 未設定なら従来フラット設定から既定ブロックを導出（サーバと同じ方針）。
function defaultBlocks(c: Config): SubmitBlock[] {
  const blocks: SubmitBlock[] = [
    { id: "greeting", type: "greeting", enabled: true, title: c.thanksTitle, message: c.thanksMessage },
    { id: "today_reward", type: "today_reward", enabled: true },
  ];
  const wantsEvent = c.rankingSource === "auto" || c.rankingSource === "event";
  const wantsPersonal = c.rankingSource === "auto" || c.rankingSource === "individual";
  if (wantsEvent)
    blocks.push({
      id: "event_points",
      type: "event_points",
      enabled: true,
      source: c.rankingSource === "event" ? "event" : "auto",
      eventId: c.linkedEventId,
      showRanking: c.teamRankingVisibleToDrivers,
    });
  if (wantsPersonal)
    blocks.push({
      id: "personal_ranking",
      type: "personal_ranking",
      enabled: true,
      label: c.metricLabel,
      metricFields: c.metricFields,
      carrierIds: [],
      targetDriverIds: c.targetDriverIds,
    });
  return blocks;
}

function makeBlock(type: BlockType): SubmitBlock {
  const id = newId();
  switch (type) {
    case "greeting":
      return { id, type, enabled: true, title: "お疲れさまでした", message: "" };
    case "today_reward":
      return { id, type, enabled: true };
    case "event_points":
      return { id, type, enabled: true, source: "auto", eventId: null, showRanking: false };
    case "personal_count":
      return { id, type, enabled: true, label: "今月の個数", metricFields: [], carrierIds: [], targetDriverIds: [] };
    case "personal_ranking":
      return { id, type, enabled: true, label: "個人ランキング", metricFields: [], carrierIds: [], targetDriverIds: [] };
  }
}

// 設定ブロック → サンプルデータでプレビュー描画用に解決。
// 実在ドライバー名を使ってよりリアルに見せる（数値はサンプル）。
function previewResolve(blocks: SubmitBlock[], driverNames: string[]): ResolvedBlock[] {
  const names = driverNames.length >= 3 ? driverNames : [...driverNames, "佐藤", "鈴木", "田中"];
  const [n1, n2, n3] = names;
  const out: ResolvedBlock[] = [];
  for (const b of blocks) {
    if (!b.enabled) continue;
    if (b.type === "greeting") out.push({ id: b.id, type: "greeting", title: b.title, message: b.message });
    else if (b.type === "today_reward") out.push({ id: b.id, type: "today_reward", todayReward: 18500 });
    else if (b.type === "event_points")
      out.push({
        id: b.id,
        type: "event_points",
        eventName: "（イベント例）",
        myTeamId: "t1",
        myTeam: { id: "t1", name: "自チーム", color: "#3b82f6", total: 2090 },
        todayPoints: 120,
        showRanking: b.showRanking,
        rankingVisible: b.showRanking,
        teams: b.showRanking
          ? [
              { rank: 1, teamId: "t2", name: "Bチーム", color: "#ef4444", total: 2210 },
              { rank: 2, teamId: "t1", name: "自チーム", color: "#3b82f6", total: 2090 },
            ]
          : [],
        individuals: b.showRanking ? [{ rank: 1, name: n1, total: 540, isMe: true }] : [],
      });
    else if (b.type === "personal_count")
      out.push({ id: b.id, type: "personal_count", label: b.label || "今月の個数", value: 1510 });
    else if (b.type === "personal_ranking")
      out.push({
        id: b.id,
        type: "personal_ranking",
        label: b.label || "個人ランキング",
        configured: b.metricFields.length > 0,
        ranking: [
          { rank: 1, name: n1, value: 1820, isMe: false },
          { rank: 2, name: n2, value: 1510, isMe: true },
          { rank: 3, name: n3, value: 1390, isMe: false },
        ],
        myRank: { rank: 2, name: n2, value: 1510, isMe: true },
        total: 12,
      });
  }
  return out;
}

export default function SubmitScreenBuilderPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [baseConfig, setBaseConfig] = useState<Config | null>(null);
  const [blocks, setBlocks] = useState<SubmitBlock[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ config: Config; drivers: DriverRow[]; carriers: CarrierRow[]; events: EventRow[] }>(
        "/api/admin/submit-screen",
      );
      setBaseConfig(res.config);
      setDrivers(res.drivers ?? []);
      setCarriers(res.carriers ?? []);
      setEvents(res.events ?? []);
      setBlocks(res.config.blocks && res.config.blocks.length > 0 ? res.config.blocks : defaultBlocks(res.config));
    } catch (e) {
      setError({ title: "読み込みに失敗しました", message: e instanceof Error ? e.message : "もう一度お試しください。" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    load();
  }, [load]);

  const preview = useMemo(
    () => previewResolve(blocks, drivers.map((d) => getDisplayName(d))),
    [blocks, drivers],
  );

  const update = (id: string, patch: Partial<SubmitBlock>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as SubmitBlock) : b)));
  const move = (id: string, dir: -1 | 1) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const copy = [...bs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const remove = (id: string) => setBlocks((bs) => bs.filter((b) => b.id !== id));
  const add = (type: BlockType) => {
    const b = makeBlock(type);
    setBlocks((bs) => [...bs, b]);
    setExpandedId(b.id);
  };

  const save = async () => {
    if (!baseConfig || !canWrite) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/submit-screen", {
        method: "PUT",
        body: JSON.stringify({ ...baseConfig, blocks }),
      });
      await load();
    } catch (e) {
      setError({ title: "保存に失敗しました", message: e instanceof Error ? e.message : "もう一度お試しください。" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">送信後画面の設定</h1>
            <p className="text-xs text-slate-500 mt-1">
              日報送信後に出る画面を「ブロック」で組み立てます。左で構成、右が実画面プレビューです。
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="shrink-0 px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2 items-start">
            {/* 左: ブロック一覧 */}
            <div className="space-y-2">
              {blocks.map((b, i) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  index={i}
                  count={blocks.length}
                  expanded={expandedId === b.id}
                  canWrite={canWrite}
                  carriers={carriers}
                  drivers={drivers}
                  events={events}
                  onToggleExpand={() => setExpandedId((x) => (x === b.id ? null : b.id))}
                  onUpdate={(patch) => update(b.id, patch)}
                  onMove={(d) => move(b.id, d)}
                  onRemove={() => remove(b.id)}
                />
              ))}

              {canWrite && (
                <div className="rounded-lg border border-dashed border-slate-300 p-3">
                  <div className="text-[11px] font-medium text-slate-500 mb-2">ブロックを追加</div>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(BLOCK_LABEL) as BlockType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => add(t)}
                        className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      >
                        ＋ {BLOCK_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 右: ライブプレビュー */}
            <div className="lg:sticky lg:top-4">
              <div className="text-[11px] font-medium text-slate-500 mb-1.5">プレビュー（サンプルデータ）</div>
              <div className="rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden">
                {preview.length > 0 ? (
                  <PostSubmitView data={{ blocks: preview }} onClose={() => {}} />
                ) : (
                  <p className="p-10 text-center text-sm text-slate-400">表示するブロックがありません</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <ErrorDialog open={!!error} title={error?.title} message={error?.message ?? ""} onClose={() => setError(null)} />
    </AdminLayout>
  );
}

function BlockRow({
  block,
  index,
  count,
  expanded,
  canWrite,
  carriers,
  drivers,
  events,
  onToggleExpand,
  onUpdate,
  onMove,
  onRemove,
}: {
  block: SubmitBlock;
  index: number;
  count: number;
  expanded: boolean;
  canWrite: boolean;
  carriers: CarrierRow[];
  drivers: DriverRow[];
  events: EventRow[];
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<SubmitBlock>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const hasConfig = block.type !== "today_reward";
  return (
    <div className={`rounded-lg border bg-white ${block.enabled ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          role="switch"
          aria-checked={block.enabled}
          disabled={!canWrite}
          onClick={() => onUpdate({ enabled: !block.enabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${block.enabled ? "bg-emerald-600" : "bg-slate-300"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${block.enabled ? "translate-x-4" : "translate-x-1"}`} />
        </button>
        <span className="text-sm font-medium text-slate-800 flex-1 min-w-0 truncate">{BLOCK_LABEL[block.type]}</span>
        {canWrite && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="上へ" className="h-9 w-9 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50">↑</button>
            <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="下へ" className="h-9 w-9 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50">↓</button>
            {hasConfig && (
              <button type="button" onClick={onToggleExpand} className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
                {expanded ? "閉じる" : "設定"}
              </button>
            )}
            <button type="button" onClick={onRemove} aria-label="削除" className="h-9 w-9 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200">×</button>
          </div>
        )}
      </div>

      {expanded && hasConfig && (
        <div className="border-t border-slate-100 p-3">
          <BlockConfig block={block} carriers={carriers} drivers={drivers} events={events} canWrite={canWrite} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

function BlockConfig({
  block,
  carriers,
  drivers,
  events,
  canWrite,
  onUpdate,
}: {
  block: SubmitBlock;
  carriers: CarrierRow[];
  drivers: DriverRow[];
  events: EventRow[];
  canWrite: boolean;
  onUpdate: (patch: Partial<SubmitBlock>) => void;
}) {
  if (block.type === "greeting") {
    return (
      <div className="space-y-2">
        <input
          value={block.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          disabled={!canWrite}
          placeholder="見出し（例：お疲れさまでした）"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <textarea
          value={block.message}
          onChange={(e) => onUpdate({ message: e.target.value })}
          disabled={!canWrite}
          rows={2}
          placeholder="補足メッセージ（任意）"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
        />
      </div>
    );
  }
  if (block.type === "event_points") {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          {(["auto", "event"] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={!canWrite}
              onClick={() => onUpdate({ source: s })}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium border ${block.source === s ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}
            >
              {s === "auto" ? "開催中を自動" : "イベント指定"}
            </button>
          ))}
        </div>
        {block.source === "event" && (
          <CustomSelect
            value={block.eventId ?? ""}
            onChange={(v) => onUpdate({ eventId: v || null })}
            disabled={!canWrite}
            clearable={false}
            placeholder="イベントを選択…"
            options={events.map((ev) => ({
              value: ev.id,
              label: `${ev.name}（${ev.status === "active" ? "開催中" : ev.status === "closed" ? "終了" : "下書き"}）`,
            }))}
          />
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={block.showRanking}
            disabled={!canWrite}
            onChange={(e) => onUpdate({ showRanking: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300"
          />
          チーム順位表も表示する（順位・他チーム・個人MVP）
        </label>
      </div>
    );
  }
  if (block.type === "personal_count" || block.type === "personal_ranking") {
    const mf = block.metricFields;
    const toggleField = (unitId: string, fieldKey: string) => {
      const exists = mf.some((f) => f.unitId === unitId && f.fieldKey === fieldKey);
      onUpdate({
        metricFields: exists
          ? mf.filter((f) => !(f.unitId === unitId && f.fieldKey === fieldKey))
          : [...mf, { unitId, fieldKey }],
      });
    };
    const toggleCarrier = (id: string) =>
      onUpdate({ carrierIds: block.carrierIds.includes(id) ? block.carrierIds.filter((x) => x !== id) : [...block.carrierIds, id] });
    const toggleDriver = (id: string) =>
      onUpdate({ targetDriverIds: block.targetDriverIds.includes(id) ? block.targetDriverIds.filter((x) => x !== id) : [...block.targetDriverIds, id] });
    return (
      <div className="space-y-3">
        <input
          value={block.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          disabled={!canWrite}
          placeholder="ラベル（例：今月の完了個数）"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <div>
          <div className="text-[11px] font-medium text-slate-600 mb-1">集計する報告項目（合計・今月）</div>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {carriers.map((c) => (
              <div key={c.id} className="px-2.5 py-1.5">
                <div className="text-[11px] font-semibold text-slate-700 mb-1">{c.name}</div>
                {c.units.map((u) => (
                  <div key={u.id} className="mb-1 last:mb-0">
                    <div className="text-[10px] text-slate-400">{u.name || u.code}</div>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {u.fields.map((f) => {
                        const on = mf.some((x) => fkid(x.unitId, x.fieldKey) === fkid(u.id, f.field_key));
                        return (
                          <button
                            key={f.id}
                            type="button"
                            disabled={!canWrite}
                            onClick={() => toggleField(u.id, f.field_key)}
                            className={`px-2.5 py-1.5 rounded-md text-[11px] border ${on ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}
                          >
                            {f.group_label ? `${f.group_label} ` : ""}
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium text-slate-600 mb-1">対象キャリア（未選択=全部・例: ヤマトのみ）</div>
          <div className="flex flex-wrap gap-1.5">
            {carriers.map((c) => {
              const on = block.carrierIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => toggleCarrier(c.id)}
                  className={`px-3 py-1.5 rounded-md text-[11px] border ${on ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        {block.type === "personal_ranking" && (
          <div>
            <div className="text-[11px] font-medium text-slate-600 mb-1">
              対象ドライバー（{block.targetDriverIds.length === 0 ? "全員" : `${block.targetDriverIds.length}名`}）
            </div>
            <div className="max-h-32 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1">
              {drivers.map((d) => {
                const on = block.targetDriverIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!canWrite}
                    onClick={() => toggleDriver(d.id)}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] border text-left ${on ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}
                  >
                    {getDisplayName(d)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
  return null;
}
