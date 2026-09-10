"use client";

// ============================================================
// シフトメモのプレビュー。
//
// 以前はこの画面に盤を丸ごと複製していたが、本番の盤（PersonalShiftMemoBoard）と
// 作りが離れていったため、**本番のコンポーネントをそのまま架空データで動かす**形にした。
// 保存先は `preview` 名前空間なので、実際の下書きは汚さない。
// ============================================================

import Link from "next/link";
import { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import PersonalShiftMemoBoard from "@/app/(admin)/admin/(ops)/shifts/PersonalShiftMemoBoard";

const START = "2026-09-16";
const DAYS = 15;

const COURSES = [
  { id: "course-a", name: "北大路（ヤマト）", summary_title: "北大路", color: "#0ea5e9", max_drivers: 3 },
  { id: "course-b", name: "西院（ヤマト）", summary_title: "西院", color: "#8b5cf6", max_drivers: 2 },
  { id: "course-c", name: "伏見（Amazon）", summary_title: "伏見", color: "#f97316", max_drivers: 2 },
];

const DRIVERS = [
  { id: "d1", name: "見本 太郎", driver_code: "A001" },
  { id: "d2", name: "見本 花子", driver_code: "A002" },
  { id: "d3", name: "見本 三郎", driver_code: "A003" },
  { id: "d4", name: "架空 一郎", driver_code: "B001" },
  { id: "d5", name: "架空 二郎", driver_code: "B002" },
  { id: "d6", name: "架空 三郎", driver_code: "B003" },
  { id: "d7", name: "試作 四郎", driver_code: "C001" },
  { id: "d8", name: "試作 五郎", driver_code: "C002" },
];

export default function ShiftMemoPreviewPage() {
  const dates = useMemo(() => {
    const base = new Date(`${START}T12:00:00`);
    return Array.from({ length: DAYS }, (_, index) => {
      const value = new Date(base);
      value.setDate(base.getDate() + index);
      return value.toISOString().slice(0, 10);
    });
  }, []);

  // 全休の希望（メモ盤で印が出る）と、便指定の希望（印は出さない）を1件ずつ入れる
  const shiftRequests = useMemo(
    () => [
      { driver_id: "d1", request_date: dates[2], slot_id: null },
      { driver_id: "d4", request_date: dates[2], slot_id: null },
      { driver_id: "d2", request_date: dates[5], slot_id: null },
      { driver_id: "d3", request_date: dates[2], slot_id: "slot-1" },
    ],
    [dates],
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/preview" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
          <FontAwesomeIcon icon={faArrowLeft} className="h-3 w-3" />
          プレビュー一覧
        </Link>
        <h1 className="text-sm font-bold text-slate-800">シフトメモ（本番の盤・架空データ）</h1>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
          下書きはこの端末の preview 領域に保存されます
        </span>
      </div>
      <PersonalShiftMemoBoard
        dates={dates}
        courses={COURSES}
        drivers={DRIVERS}
        today={dates[0]}
        shiftRequests={shiftRequests}
        storageNamespace="preview"
      />
    </div>
  );
}
