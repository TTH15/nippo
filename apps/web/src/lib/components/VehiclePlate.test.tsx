import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("img", { name: "もうすぐオイル交換です" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("セル全体では開かず、警告マークの補足だけを表の外に表示する", () => {
    const onClick = vi.fn();
    const { container } = render(
      <button className="group" onClick={onClick}>
        <VehiclePlate className="pointer-events-none" vehicle={{ ...baseVehicle, current_mileage: 5_100, oil_change_interval: 5_000 }} />
      </button>,
    );
    fireEvent.pointerEnter(screen.getByRole("button"), { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    const warning = screen.getByRole("img", { name: "オイル交換が必要です" });
    fireEvent.pointerEnter(warning, { pointerType: "mouse" });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("オイル交換が必要です");
    expect(tooltip.parentElement).toBe(document.body);
    expect(container).not.toContainElement(tooltip);
    expect(warning).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.click(warning);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("離脱・スクロール・Escapeで補足を閉じ、タッチではホバー表示しない", () => {
    render(<VehiclePlate vehicle={{ ...baseVehicle, current_mileage: 5_100, oil_change_interval: 5_000 }} />);
    const warning = screen.getByRole("img", { name: "オイル交換が必要です" });
    fireEvent.pointerEnter(warning, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(warning, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(warning);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(warning);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(warning, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(warning);
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(warning);
    fireEvent.blur(warning);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("キーボードで移動したマークは自動スクロール後も補足を読める", () => {
    render(<VehiclePlate vehicle={{ ...baseVehicle, current_mileage: 5_100, oil_change_interval: 5_000 }} />);
    const warning = screen.getByRole("img", { name: "オイル交換が必要です" });
    act(() => warning.focus());
    fireEvent.scroll(window);
    expect(warning).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent("オイル交換が必要です");
    act(() => warning.blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
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
