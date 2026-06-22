// 諸報告フォームビルダーのフィールド定義型（純型・UI/DOM/ランタイム非依存）。
// 正準の型はここ（core）に置き、サーバ側 validation（server/reportKinds/fields）が
// これらを import して再export する。Web/RN 双方からこの型を参照する。
export type FieldType =
  | "short_text"
  | "long_text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "time"
  | "bool"
  | "file";

export type FieldRole = "none" | "odometer" | "amount";

export type FieldOption = { value: string; label: string };

export type ReportField = {
  /** 種別内で安定なID（answers のキー）。 */
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  maxLen?: number; // short_text/long_text
  min?: number; // number
  max?: number; // number
  options?: FieldOption[]; // select/multiselect
  role?: FieldRole; // number のみ。capability 束縛用
  maxFileBytes?: number; // file
  acceptMime?: string[]; // file
};

export type VehicleMode = "required" | "optional" | "none";

// 添付（answers とは別に保持）
export type AnswerAttachment = { fieldId: string; path: string; name: string; mime: string; size: number };
