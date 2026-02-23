"use client";

import { useState, useMemo, useEffect } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type DataPoint = { date: string; yamato: number; amazon: number; profit: number };

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Period = "2weeks" | "month" | "quarter";

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-4 py-3 text-sm">
      <p className="font-medium text-slate-900 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-slate-600">{entry.name}</span>
          <span className="ml-auto font-medium text-slate-900 pl-4">
            {fmt(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function SalesPage() {
  const [period, setPeriod] = useState<Period>("2weeks");
  const [month, setMonth] = useState(currentMonth());
  const [deliveryData, setDeliveryData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: DataPoint[] }>(`/api/admin/sales?month=${month}`)
      .then((res) => setDeliveryData(res.data ?? []))
      .catch(() => setDeliveryData([]))
      .finally(() => setLoading(false));
  }, [month]);

  const displayData = useMemo(() => {
    if (period === "2weeks") return deliveryData.slice(-14);
    if (period === "month") return deliveryData;
    return deliveryData;
  }, [deliveryData, period]);

  const totals = useMemo(() => {
    const yamato = displayData.reduce((s, d) => s + d.yamato, 0);
    const amazon = displayData.reduce((s, d) => s + d.amazon, 0);
    const profit = displayData.reduce((s, d) => s + d.profit, 0);
    return { yamato, amazon, total: yamato + amazon, profit };
  }, [displayData]);

  const dailyAvg = useMemo(() => {
    const len = displayData.length || 1;
    return {
      revenue: Math.round(totals.total / len),
      profit: Math.round(totals.profit / len),
    };
  }, [totals, displayData.length]);

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">売上分析</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              売上（積み上げ棒グラフ）と利益（折れ線）の推移
            </p>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
            />
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {(
              [
                { key: "2weeks", label: "2週間" },
                { key: "month", label: "月間" },
                { key: "quarter", label: "四半期" },
              ] as const
            ).map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  period === p.key
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {p.label}
              </button>
            ))}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 py-8">読み込み中...</p>
        ) : displayData.length === 0 ? (
          <p className="text-sm text-slate-500 py-8">該当データがありません</p>
        ) : (
        <>
        {/* サマリーカード */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">総売上</div>
            <div className="text-lg font-bold text-slate-900">{fmt(totals.total)}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              日平均 {fmt(dailyAvg.revenue)}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">ヤマト売上</div>
            <div className="text-lg font-bold text-slate-700">{fmt(totals.yamato)}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              構成比 {((totals.yamato / totals.total) * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">Amazon売上</div>
            <div className="text-lg font-bold text-slate-400">{fmt(totals.amazon)}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              構成比 {((totals.amazon / totals.total) * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">総利益</div>
            <div className="text-lg font-bold text-emerald-600">{fmt(totals.profit)}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              日平均 {fmt(dailyAvg.profit)}
            </div>
          </div>
        </div>

        {/* チャート */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart
              data={displayData}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                width={54}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                width={54}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: "16px", fontSize: "12px" }}
                iconType="square"
                iconSize={10}
              />

              <Bar
                yAxisId="left"
                dataKey="yamato"
                stackId="revenue"
                fill="#334155"
                name="ヤマト売上"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                yAxisId="left"
                dataKey="amazon"
                stackId="revenue"
                fill="#94a3b8"
                name="Amazon売上"
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="profit"
                stroke="#059669"
                strokeWidth={2.5}
                name="利益"
                dot={{ fill: "#059669", r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        </>
        )}
      </div>
    </AdminLayout>
  );
}
