"use client";

import { useState, useMemo } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
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

const deliveryData = [
  { date: "2/6", yamato: 1200000, amazon: 800000, profit: 350000 },
  { date: "2/7", yamato: 1350000, amazon: 900000, profit: 420000 },
  { date: "2/8", yamato: 1100000, amazon: 750000, profit: 310000 },
  { date: "2/9", yamato: 1450000, amazon: 950000, profit: 480000 },
  { date: "2/10", yamato: 1600000, amazon: 1100000, profit: 550000 },
  { date: "2/11", yamato: 1250000, amazon: 850000, profit: 390000 },
  { date: "2/12", yamato: 1180000, amazon: 780000, profit: 360000 },
  { date: "2/13", yamato: 1400000, amazon: 920000, profit: 450000 },
  { date: "2/14", yamato: 1550000, amazon: 1050000, profit: 520000 },
  { date: "2/15", yamato: 1320000, amazon: 880000, profit: 410000 },
  { date: "2/16", yamato: 1280000, amazon: 860000, profit: 400000 },
  { date: "2/17", yamato: 1500000, amazon: 1000000, profit: 490000 },
  { date: "2/18", yamato: 1650000, amazon: 1150000, profit: 580000 },
  { date: "2/19", yamato: 1420000, amazon: 950000, profit: 470000 },
];

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

  const totals = useMemo(() => {
    const yamato = deliveryData.reduce((s, d) => s + d.yamato, 0);
    const amazon = deliveryData.reduce((s, d) => s + d.amazon, 0);
    const profit = deliveryData.reduce((s, d) => s + d.profit, 0);
    return { yamato, amazon, total: yamato + amazon, profit };
  }, []);

  const dailyAvg = useMemo(() => {
    const len = deliveryData.length;
    return {
      revenue: Math.round(totals.total / len),
      profit: Math.round(totals.profit / len),
    };
  }, [totals]);

  return (
    <AdminLayout>
      <div className="max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">売上分析</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              売上（積み上げ棒グラフ）と利益（折れ線）の推移
            </p>
          </div>
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
              data={deliveryData}
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
      </div>
    </AdminLayout>
  );
}
