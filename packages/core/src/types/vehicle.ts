// 車両関連の型（ドライバー画面・運営画面 共通）。
// プレート表示の最小契約 VehiclePlateData を正準とし、用途別に拡張する。
// UI/DOM 非依存。React Native 移行時もそのまま再利用できる。

/** ナンバープレートの色（実物の4種）。未設定は black（軽事業用）として描画する */
export type PlateColor = "white" | "yellow" | "green" | "black";

/** ナンバープレート表示に必要な車両情報（全画面共通の最小契約） */
export type VehiclePlateData = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  plate_color?: PlateColor | string | null;
  manufacturer?: string | null;
  brand?: string | null;
  /** プレート上の整備警告表示に使う任意情報。取得しない画面は従来どおり表示のみ。 */
  current_mileage?: number | null;
  is_ev?: boolean | null;
  last_oil_change_mileage?: number | null;
  oil_change_interval?: number | null;
};

/** 日報送信フォームで扱う車両（プレート情報＋走行距離・EV判定＋オイル交換情報） */
export type SubmitVehicle = VehiclePlateData & {
  current_mileage?: number;
  is_ev?: boolean;
  last_oil_change_mileage?: number;
  oil_change_interval?: number;
};

/** シフト表示に紐づく車両（各プレート項目は必須・null許容） */
export type ShiftVehicle = {
  id: string;
  number_prefix: string | null;
  number_class: string | null;
  number_hiragana: string | null;
  number_numeric: string | null;
  manufacturer: string | null;
  brand: string | null;
};
