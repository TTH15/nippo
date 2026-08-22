type DatabaseErrorLike = { code?: string | null; message?: string | null } | null | undefined;

/** migration 147 未適用環境で、一時使用不可列だけが原因のエラーかを判定する。 */
export function isMissingVehicleAvailabilityColumns(error: DatabaseErrorLike): boolean {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  const mentionsAvailabilityColumn =
    message.includes("is_unavailable") || message.includes("unavailable_reason");
  return mentionsAvailabilityColumn && (error.code === "42703" || message.includes("does not exist"));
}
