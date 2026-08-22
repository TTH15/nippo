import { describe, expect, it } from "vitest";
import { isMissingVehicleAvailabilityColumns } from "./availabilitySchema";

describe("isMissingVehicleAvailabilityColumns", () => {
  it("migration未適用の列不存在エラーだけを検出する", () => {
    expect(
      isMissingVehicleAvailabilityColumns({
        code: "42703",
        message: "column vehicles.is_unavailable does not exist",
      }),
    ).toBe(true);
    expect(
      isMissingVehicleAvailabilityColumns({
        code: "42703",
        message: "column vehicles.unavailable_reason does not exist",
      }),
    ).toBe(true);
  });

  it("認証・通信など別原因のエラーはフォールバック対象にしない", () => {
    expect(isMissingVehicleAvailabilityColumns({ code: "42501", message: "permission denied" })).toBe(
      false,
    );
    expect(isMissingVehicleAvailabilityColumns({ code: "57014", message: "timeout" })).toBe(false);
  });
});
