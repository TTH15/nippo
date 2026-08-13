// 単発案件（spot-jobs）画面の共有型。API のシリアライズ形と一致させる。
export type SpotJobStatus = "planned" | "done" | "cancelled";

export type SpotJobMember = {
  id: string;
  driverId: string | null;
  displayName: string | null;
  payAmount: number | null;
};

export type SpotJob = {
  id: string;
  title: string;
  jobDate: string; // YYYY-MM-DD
  meetingPlace: string | null;
  meetingTime: string | null; // HH:MM
  endTime: string | null; // HH:MM
  clientName: string | null;
  billingAmount: number | null;
  note: string | null;
  status: SpotJobStatus;
  members: SpotJobMember[];
};

export type MemberCandidate = { id: string; name: string; isGuest: boolean };

export type SpotJobSavePayload = {
  title: string;
  jobDate: string;
  meetingPlace: string | null;
  meetingTime: string | null;
  endTime: string | null;
  clientName: string | null;
  billingAmount: number | null;
  note: string | null;
  status: SpotJobStatus;
  members: { driverId: string | null; displayName: string | null; payAmount: number | null }[];
};

export const STATUS_LABEL: Record<SpotJobStatus, string> = {
  planned: "予定",
  done: "完了",
  cancelled: "中止",
};
