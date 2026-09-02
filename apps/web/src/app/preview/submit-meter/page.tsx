"use client";

// ============================================================
// 日報送信フォーム（/submit）のプレビュー（開発用・認証不要）。
//   本番の実画面 SubmitPageClientV2 をそのまま描画し、window.fetch を差し替えて
//   架空データを返す。本番の認証・DB・API・通知には一切つながらない
//   （/api/ 宛の通信はすべてこのページ内で握りつぶす）。
//
// 目的: 走行距離（メーター）の入力チェックの確認。
//   基準は「車両に登録されている走行距離（vehicles.current_mileage）」で、
//   それ以下の値は赤字で警告し、送信もブロックされる（2026-09-02 変更）。
//   登録走行距離が未登録(0)の車両は初回入力として任意の値を通す。
//
// 制限: 送信しても保存されない（POST はモックが成功を返すだけ）。
//   送信後画面・通知・報酬は最小限の架空データ。
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Nav } from "@/lib/components/Nav";
import SubmitPageClientV2 from "@/app/(user)/submit/SubmitPageClientV2";

type MockVehicle = {
  id: string;
  number_prefix: string;
  number_class: string;
  number_hiragana: string;
  number_numeric: string;
  plate_color: string;
  manufacturer: string;
  brand: string;
  current_mileage: number;
  is_ev: boolean;
  last_oil_change_mileage: number;
  oil_change_interval: number;
};

// 登録走行距離あり / 未登録 / EV の3台。オイル交換はいずれも余裕あり（自動モーダルを出さない）。
const VEHICLES: MockVehicle[] = [
  {
    id: "veh-1",
    number_prefix: "品川",
    number_class: "480",
    number_hiragana: "あ",
    number_numeric: "1201",
    plate_color: "black",
    manufacturer: "ホンダ",
    brand: "アクティ",
    current_mileage: 50000,
    is_ev: false,
    last_oil_change_mileage: 48000,
    oil_change_interval: 15000,
  },
  {
    id: "veh-2",
    number_prefix: "品川",
    number_class: "480",
    number_hiragana: "い",
    number_numeric: "2752",
    plate_color: "black",
    manufacturer: "スズキ",
    brand: "エブリイ",
    current_mileage: 0, // 走行距離が未登録の車両（初回入力）
    is_ev: false,
    last_oil_change_mileage: 0,
    oil_change_interval: 15000,
  },
  {
    id: "veh-3",
    number_prefix: "品川",
    number_class: "480",
    number_hiragana: "う",
    number_numeric: "4303",
    plate_color: "black",
    manufacturer: "日産",
    brand: "クリッパーEV",
    current_mileage: 12000,
    is_ev: true, // EV はメーター入力欄が出ない
    last_oil_change_mileage: 0,
    oil_change_interval: 0,
  },
];

const SHIFT = {
  courseId: "course-1",
  cycleNo: 1,
  cycleLabel: "1便",
  courseName: "北ルート",
  color: "#3b82f6",
  carrierId: "carrier-1",
  carrierName: "プレビュー運輸",
  units: [
    {
      id: "unit-1",
      name: "宅配",
      code: "TAKUHAI",
      billingType: "PER_PIECE",
      fields: [
        { fieldKey: "delivered", label: "完了", inputType: "INT", groupLabel: "個数", required: true },
        { fieldKey: "undelivered", label: "持戻り", inputType: "INT", groupLabel: "個数", required: false },
      ],
    },
  ],
  existing: null,
};

/** /api/ 宛のリクエストに架空データを返す。それ以外は本来の fetch に委ねる。 */
function mockResponse(url: string, method: string): unknown | undefined {
  if (method === "POST" && url.includes("/api/reports/v2")) return { ok: true };
  if (url.includes("/api/reports/profile")) {
    return { identities: [{ id: "identity-1", slot: 1, driverCode: "0123", officeCode: "45", label: "1つ目" }] };
  }
  if (url.includes("/api/reports/vehicles-unlinked")) return { vehicles: [] };
  if (url.includes("/api/reports/vehicles")) return { vehicles: VEHICLES };
  if (url.includes("/api/me/report-form")) return { shifts: [SHIFT], shiftVehicleId: null };
  if (url.includes("/api/me/form-notice")) return { notice: null };
  if (url.includes("/api/me/shift-deadline-reminder")) return { reminder: null };
  if (url.includes("/api/me/submit-screen")) {
    return {
      todayReward: 12000,
      blocks: [
        { id: "greeting", type: "greeting", title: "お疲れさまでした", message: "" },
        { id: "reward", type: "today_reward", todayReward: 12000 },
      ],
    };
  }
  if (url.includes("/api/")) return {}; // 通知バッジ等は空で返す
  return undefined;
}

export default function SubmitMeterPreviewPage() {
  const [ready, setReady] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const posted = useRef<number>(0);
  const [postedCount, setPostedCount] = useState(0);

  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const body = mockResponse(url, method);
      if (body === undefined) return original(input, init);
      if (method === "POST" && url.includes("/api/reports/v2")) {
        posted.current += 1;
        setPostedCount(posted.current);
      }
      await new Promise((r) => setTimeout(r, 200)); // 通信遅延の疑似再現
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    setReady(true);
    return () => {
      window.fetch = original;
    };
  }, []);

  const summary = useMemo(
    () => VEHICLES.map((v) => `${v.number_numeric}: ${v.is_ev ? "EV（入力欄なし）" : v.current_mileage > 0 ? `${v.current_mileage.toLocaleString("ja-JP")} km 登録済み` : "走行距離 未登録"}`),
    [],
  );

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* プレビュー操作バー */}
      <div className="sticky top-0 z-[60] border-b border-amber-200 bg-amber-50 px-4 py-2.5">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-semibold text-amber-800">プレビュー（保存なし・本番DBに接続しません）</span>
          <span className="text-xs text-amber-700">{summary.join(" / ")}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-amber-700">送信試行: {postedCount} 回</span>
            <button
              type="button"
              onClick={() => setRunKey((n) => n + 1)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              最初から
            </button>
          </div>
        </div>
      </div>

      {/* 以下は実画面 /submit と同じ構成（(user)/layout.tsx の Nav + main） */}
      <div className="flex min-h-screen flex-col">
        <Nav variant="user" />
        <main className="flex-1 pb-10">
          {ready ? <SubmitPageClientV2 key={runKey} /> : null}
        </main>
      </div>
    </div>
  );
}
