import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SortableList } from "./SortableList";

afterEach(cleanup);

function Example({ single = false }: { single?: boolean }) {
  const [items, setItems] = useState((single ? ["件名"] : ["件名", "発生日", "報告内容"]).map(id => ({ id, value: "" })));
  return <SortableList label="項目" items={items} onReorder={setItems} getLabel={item => item.id}>
    {(item, handle) => <>{handle}<label>{item.id}<input value={item.value} onChange={event => setItems(current => current.map(i => i.id === item.id ? { ...i, value: event.target.value } : i))}/></label></>}
  </SortableList>;
}

function order() {
  return within(screen.getByRole("list", { name: "項目" })).getAllByRole("textbox").map(input => input.getAttribute("value"));
}
function labels() {
  return within(screen.getByRole("list", { name: "項目" })).getAllByRole("button").map(button => button.getAttribute("aria-label"));
}

describe("SortableList", () => {
  it("キーボードで並べ替えても入力値とフォーカスが項目に追従する", () => {
    render(<Example/>);
    fireEvent.change(screen.getByRole("textbox", { name: "件名" }), { target: { value: "編集中の件名" } });
    const handle = screen.getByRole("button", { name: "件名を並べ替え" });
    handle.focus();
    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(labels()).toEqual(["発生日を並べ替え", "件名を並べ替え", "報告内容を並べ替え"]);
    expect(order()).toEqual(["", "編集中の件名", ""]);
    expect(handle).toHaveFocus();
    expect(handle).toHaveAttribute("aria-pressed", "false");
  });

  it("Escapeは順序を戻し、項目の編集内容は残す", () => {
    render(<Example/>);
    const handle = screen.getByRole("button", { name: "件名を並べ替え" });
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.change(screen.getByRole("textbox", { name: "件名" }), { target: { value: "修正した値" } });
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(labels()).toEqual(["件名を並べ替え", "発生日を並べ替え", "報告内容を並べ替え"]);
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("修正した値");
    expect(screen.getByRole("status")).toHaveTextContent("取り消しました");
  });

  it("操作開始前の矢印キーや先頭・末尾を越える移動で順序を変えない", () => {
    render(<Example/>);
    const handle = screen.getByRole("button", { name: "件名を並べ替え" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(labels()[0]).toBe("件名を並べ替え");
    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(labels()[0]).toBe("件名を並べ替え");
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(labels()[2]).toBe("件名を並べ替え");
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "Tab" });
    expect(labels()[0]).toBe("件名を並べ替え");
    expect(handle).toHaveAttribute("aria-pressed", "false");
  });

  it("1項目だけのリストではハンドルを無効化する", () => {
    render(<Example single/>);
    expect(screen.getByRole("button", { name: "件名を並べ替え" })).toBeDisabled();
  });
});
