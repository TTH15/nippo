import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { SmoothCollapse } from "./SmoothCollapse";

afterEach(cleanup);

it("閉じ始めたパネルを即座に操作対象から外し、開き直しても入力値を保つ", async () => {
  function Example() {
    const [open, setOpen] = useState(true);
    const [value, setValue] = useState("");
    return <>
      <button id="toggle" aria-controls="panel" aria-expanded={open} onClick={() => setOpen(!open)}>詳細</button>
      <SmoothCollapse open={open} id="panel" labelledBy="toggle">
        <input aria-label="内容" value={value} onChange={event => setValue(event.target.value)}/>
      </SmoothCollapse>
    </>;
  }
  render(<Example/>);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "保存前の入力" } });
  fireEvent.click(screen.getByRole("button", { name: "詳細" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(document.getElementById("panel")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByLabelText("内容").closest("[inert]")).not.toBeNull();
  await waitFor(() => expect(screen.queryByLabelText("内容")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "詳細" }));
  expect(screen.getByRole("textbox")).toHaveValue("保存前の入力");
  expect(screen.getByRole("region", { name: "詳細" })).not.toHaveAttribute("aria-hidden");
});
