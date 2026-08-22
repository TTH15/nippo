import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VehiclePlate } from "./VehiclePlate";

const baseVehicle = {
  id: "vehicle-1",
  number_prefix: "京都",
  number_class: "480",
  number_hiragana: "り",
  number_numeric: "1234",
};

describe("VehiclePlate の整備警告", () => {
  it("オイル交換まで300km以内なら右上に警告を表示する", () => {
    render(
      <VehiclePlate
        vehicle={{
          ...baseVehicle,
          current_mileage: 9_750,
          last_oil_change_mileage: 5_000,
          oil_change_interval: 5_000,
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "オイル交換まで残り250kmです" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("オイル交換まで残り250kmです");
  });

  it("安全圏またはEVなら警告を表示しない", () => {
    const { rerender } = render(
      <VehiclePlate
        vehicle={{
          ...baseVehicle,
          current_mileage: 9_000,
          last_oil_change_mileage: 5_000,
          oil_change_interval: 5_000,
        }}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();

    rerender(
      <VehiclePlate
        vehicle={{
          ...baseVehicle,
          current_mileage: 10_000,
          last_oil_change_mileage: 5_000,
          oil_change_interval: 5_000,
          is_ev: true,
        }}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("VehiclePlate の一時使用不可表示", () => {
  it("使用不可ラベルと理由をアクセシブルな名前で表示する", () => {
    render(
      <VehiclePlate
        vehicle={{
          ...baseVehicle,
          is_unavailable: true,
          unavailable_reason: "故障のため修理中",
        }}
      />,
    );

    expect(screen.getByRole("status", { name: "一時使用不可：故障のため修理中" })).toHaveTextContent(
      "使用不可",
    );
  });
});
