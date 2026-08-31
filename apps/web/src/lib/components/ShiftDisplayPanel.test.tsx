import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ShiftDisplayPanel } from "./ShiftDisplayPanel";

afterEach(cleanup);

it("開閉ではシフト表を再描画せず、表示項目の変更だけを表に反映する", async () => {
  const renderTable = vi.fn();
  function Table({ showVehicle }: { showVehicle: boolean }) {
    renderTable();
    return <output aria-label="シフト表">{showVehicle ? "シフトと車両" : "シフトのみ"}</output>;
  }
  function Example() {
    const [showVehicle, setShowVehicle] = useState(true);
    return <>
      <ShiftDisplayPanel toolbar={trigger => <div>{trigger}<button>画像保存</button></div>}>
        <button aria-pressed={showVehicle} onClick={() => setShowVehicle(value => !value)}>車両</button>
      </ShiftDisplayPanel>
      <Table showVehicle={showVehicle}/>
    </>;
  }
  render(<Example/>);
  const initialRenders = renderTable.mock.calls.length;
  const toggle = screen.getByRole("button", { name: "表示" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(screen.getByRole("region", { name: "表示" })).toHaveAttribute("id", toggle.getAttribute("aria-controls"));
  expect(renderTable).toHaveBeenCalledTimes(initialRenders);

  fireEvent.click(screen.getByRole("button", { name: "車両" }));
  expect(screen.getByLabelText("シフト表")).toHaveTextContent("シフトのみ");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const changedRenders = renderTable.mock.calls.length;
  expect(changedRenders).toBeGreaterThan(initialRenders);

  fireEvent.click(toggle);
  expect(screen.queryByRole("button", { name: "車両" })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("車両")).not.toBeInTheDocument());
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "車両" })).toHaveAttribute("aria-pressed", "false");
  expect(renderTable).toHaveBeenCalledTimes(changedRenders);
});
