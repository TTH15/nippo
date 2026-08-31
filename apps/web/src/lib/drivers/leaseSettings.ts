export type LeaseSettings = { id?: string; mode: "MONTHLY" | "DAILY"; amount: number; valid_from: string; valid_to?: string | null };
export type LeaseSettingsState = { lease: LeaseSettings | null; revision: string; upcoming: LeaseSettings[] };
