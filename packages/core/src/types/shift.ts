// シフト・希望休に関する型。UI/DOM 非依存。
import type { ShiftVehicle } from "./vehicle";

/** 希望休リクエスト（サーバ保存値） */
export type ShiftRequest = {
  id: string;
  driver_id: string;
  request_date: string;
  request_type: string;
  slot_id: string | null;
};

/** 希望休の提出期間（締切・ロック状態を含む） */
export type PeriodInfo = {
  seq: number;
  label: string; // "1〜15" 等
  deadline: string; // YYYY-MM-DD
  closed: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

/** 自分に割り当てられたシフト（確認タブ表示用） */
export type MeShift = {
  shift_date: string;
  course_name: string;
  course_color: string | null;
  slot: number;
  vehicle: ShiftVehicle | null;
};
