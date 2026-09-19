export function isMissingVehiclePartColors(error: { code?: string; message?: string } | null): boolean {
  return !!error && ["42703", "PGRST204"].includes(error.code ?? "") && /part_colors/i.test(error.message ?? "");
}
