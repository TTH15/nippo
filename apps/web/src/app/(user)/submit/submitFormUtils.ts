// 日報提出フォーム(v2)の純粋ロジック。コンポーネントから分離してテスト可能にする。

export type MeterVehicle = { is_ev?: boolean; current_mileage?: number | null } | null;

export type MeterState = {
  /** メーター入力が必要（車両あり & 非EV）か */
  required: boolean;
  /** 車両に登録されている現在の走行距離（未登録は0） */
  prevKm: number;
  /** 必須なのに未入力か */
  missing: boolean;
  /** 入力済みだが登録値以下（オドメーターは単調増加すべき）か */
  belowPrev: boolean;
  /** メーター観点で送信してよいか */
  canSubmit: boolean;
};

/**
 * 選択車両と入力メーターから送信可否を判定する。
 * UI 表示（赤字）と submit() のガードで同一ロジックを使い、
 * 「表示は赤いのに送信は通る」不整合を防ぐ。
 */
export function evaluateMeter(meter: string, vehicle: MeterVehicle): MeterState {
  const required = !!vehicle && !vehicle.is_ev;
  const prevKm = vehicle?.current_mileage ?? 0;
  const trimmed = meter.trim();
  const missing = required && trimmed === "";
  // 走行距離が未登録(prevKm=0)の車両は単調増加チェックを行わない（初回入力のため）。
  const belowPrev = required && trimmed !== "" && prevKm > 0 && Number(trimmed) <= prevKm;
  return { required, prevKm, missing, belowPrev, canSubmit: !missing && !belowPrev };
}
