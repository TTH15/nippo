import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FormBuilder from "./FormBuilder";
import { initialDemo, makeTemplate } from "./model";

afterEach(cleanup);

it("対応状況は有効・無効だけを切り替え、再び有効にすると共通の3状態を使う", () => {
  const onApply = vi.fn();
  render(<FormBuilder form={makeTemplate("case", "demo")} onApply={onApply} onClose={vi.fn()} existingCount={2}/>);
  fireEvent.click(screen.getByRole("tab", { name: "一覧・状態" }));
  expect(screen.queryByRole("checkbox", { name: "完了として扱う" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "状態を追加" })).not.toBeInTheDocument();
  const enabled = screen.getByRole("checkbox", { name: "対応状況を使う" });
  fireEvent.click(enabled);
  expect(screen.queryByRole("list", { name: "共通の対応状況" })).not.toBeInTheDocument();
  fireEvent.click(enabled);
  fireEvent.click(screen.getByRole("button", { name: "設定を適用" }));
  fireEvent.click(screen.getByRole("button", { name: "適用する" }));
  expect(onApply.mock.calls[0][0].statuses).toEqual([
    { id: "open", label: "未対応", terminal: false },
    { id: "progress", label: "対応中", terminal: false },
    { id: "resolved", label: "解決済み", terminal: true },
  ]);
});

it("一覧設定の変更は表示例と適用結果に反映し、必須設定や記録の回答を変えない", () => {
  const { forms, records } = initialDemo();
  const original = structuredClone(records[0]);
  const onApply = vi.fn();
  render(<FormBuilder form={forms[0]} sampleRecord={records[0]} onApply={onApply} onClose={vi.fn()} existingCount={2}/>);
  expect(screen.queryByRole("checkbox", { name: "一覧に表示" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "一覧・状態" }));
  const example = within(screen.getByRole("region", { name: "記録一覧の表示例" }));
  expect(screen.queryByRole("checkbox", { name: "件名" })).not.toBeInTheDocument();
  expect(example.getByText("2026-08-29")).toBeInTheDocument();
  expect(example.queryByText("集合住宅（サンプル）")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "場所" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "発生日" }));
  expect(example.getByText("集合住宅（サンプル）")).toBeInTheDocument();
  expect(example.queryByText("2026-08-29")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "設定を適用" }));
  fireEvent.click(screen.getByRole("button", { name: "適用する" }));
  const saved = onApply.mock.calls[0][0];
  expect(saved.fields.find((f: { id: string }) => f.id === "date")).toMatchObject({ inList: false, required: true });
  expect(saved.fields.find((f: { id: string }) => f.id === "place")).toMatchObject({ inList: true, required: false });
  expect(saved.access).toEqual(forms[0].access);
  expect(records[0]).toEqual(original);
});

function setup() {
  return render(<FormBuilder form={makeTemplate("memo", "demo")} onApply={vi.fn()} onClose={vi.fn()} existingCount={0}/>);
}

it("見出しの直接編集で入力欄の名前が更新され、独立したプレビューはない", () => {
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "項目名 1" }), { target: { value: "引き継ぎの件名" } });
  expect(screen.getByRole("textbox", { name: /引き継ぎの件名\s*\*/ })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "入力プレビュー" })).not.toBeInTheDocument();
});

it("新しい項目は名前から自動選択でき、元に戻した後は上書きしない", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "末尾に項目を追加" }));
  const title = screen.getByRole("textbox", { name: "項目名 4" });
  fireEvent.change(title, { target: { value: "支払日" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "入力形式 4" })).toHaveTextContent("日付"));
  fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
  expect(screen.getByRole("button", { name: "入力形式 4" })).toHaveTextContent("短い文章");
  fireEvent.change(title, { target: { value: "支払金額" } });
  expect(screen.getByRole("button", { name: "形式の自動選択 OFF" })).toHaveAttribute("aria-pressed", "false");
});

it("日本語変換中は入力形式を変えず、変換確定後に推定する", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "末尾に項目を追加" }));
  const title = screen.getByRole("textbox", { name: "項目名 4" });
  fireEvent.compositionStart(title);
  fireEvent.change(title, { target: { value: "支払日" } });
  await new Promise(resolve => setTimeout(resolve, 550));
  expect(screen.getByRole("button", { name: "入力形式 4" })).toHaveTextContent("短い文章");
  fireEvent.compositionEnd(title);
  await waitFor(() => expect(screen.getByRole("button", { name: "入力形式 4" })).toHaveTextContent("日付"));
});

it("既存項目は名前を変えても形式を保ち、手動で選択できる", async () => {
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "項目名 1" }), { target: { value: "支払日" } });
  const trigger = screen.getByRole("button", { name: "入力形式 1" });
  expect(trigger).toHaveTextContent("短い文章");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: /長い文章.*経緯/ }));
  expect(trigger).toHaveTextContent("長い文章");
  expect(within(screen.getByRole("list", { name: "フォームの項目" })).getByRole("textbox", { name: /支払日\s*\*/ }).tagName).toBe("TEXTAREA");
});

it("カード上で変更した項目名・選択肢を設定として適用し、試し入力は保存しない", () => {
  const onApply = vi.fn();
  render(<FormBuilder form={makeTemplate("case", "demo")} onApply={onApply} onClose={vi.fn()} existingCount={2}/>);
  fireEvent.change(screen.getByRole("textbox", { name: /件名\s*\*/ }), { target: { value: "これは試し入力" } });
  const title = screen.getByRole("textbox", { name: "項目名 4" });
  fireEvent.focus(title);
  fireEvent.change(title, { target: { value: "案件の分類" } });
  fireEvent.change(screen.getByRole("textbox", { name: "選択肢 1" }), { target: { value: "住所違い" } });
  fireEvent.click(screen.getByRole("button", { name: "設定を適用" }));
  fireEvent.click(screen.getByRole("button", { name: "適用する" }));
  const saved = onApply.mock.calls[0][0];
  expect(saved.fields[3].label).toBe("案件の分類");
  expect(saved.fields[3].options[0]).toEqual({ value: "misdelivery", label: "住所違い" });
  expect(saved.version).toBe(2);
  expect(JSON.stringify(saved)).not.toContain("これは試し入力");
});

it("自由入力のその他は通常の選択肢とは別に追加・削除できる", () => {
  const onApply = vi.fn();
  render(<FormBuilder form={makeTemplate("case", "demo")} onApply={onApply} onClose={vi.fn()} existingCount={0}/>);
  fireEvent.focus(screen.getByRole("textbox", { name: "項目名 4" }));
  expect(screen.getByText("回答者が自由に入力")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "その他の自由入力を削除" }));
  expect(screen.queryByText("回答者が自由に入力")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "「その他」を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "設定を適用" }));
  fireEvent.click(screen.getByRole("button", { name: "適用する" }));
  const field = onApply.mock.calls[0][0].fields.find((field: { id: string }) => field.id === "category");
  expect(field.allowOther).toBe(true);
  expect(field.options.map((option: { label: string }) => option.label)).toEqual(["誤配", "無断置き配", "遅配"]);
});
