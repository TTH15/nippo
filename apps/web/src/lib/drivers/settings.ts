import type { VehiclePlateData } from "@repo/core/types";

export type DriverSettingsRow = {
  id: string;
  name: string;
  lease: "MONTHLY" | "DAILY" | null;
  vehicleIds: string[];
  parking: boolean;
};
export type DriverSettings = {
  drivers: DriverSettingsRow[];
  vehicles: VehiclePlateData[];
  permissions: { viewLease: boolean; editLease: boolean; viewVehicles: boolean; editVehicles: boolean; editRequirements: boolean };
};
export const driverSettingsPath = "/api/admin/driver-settings";
export const leaseLabels = { MONTHLY: "月額", DAILY: "日割り", NONE: "なし" };
