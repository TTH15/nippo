import { EventEmitter } from "events";

export type DailyReportSubmittedPayload = {
  driverId: string;
  driverName: string;
  reportDate: string;
  takuhaibinCompleted: number;
  takuhaibinReturned: number;
  nekoposCompleted: number;
  nekoposReturned: number;
  submittedAt: string;
};

class AppEventBus extends EventEmitter {}

export const bus = new AppEventBus();

// Register listeners
import("./listeners/dailyReportSubmitted");
