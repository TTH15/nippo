import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import RecordFormsPreview from "./RecordFormsPreview";

afterEach(cleanup);

const main = () => within(screen.getByRole("main"));
const go = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "管理メニュー" })).getByRole("button", { name }));

it("記録側に管理操作を置かず、別フォームの設定から戻っても閲覧中の種類を保つ", () => {
  render(<RecordFormsPreview/>);
  expect(main().queryByRole("button", { name: "フォームを追加" })).not.toBeInTheDocument();
  expect(main().queryByRole("button", { name: "フォーム設定" })).not.toBeInTheDocument();
  go("フォーム管理");
  expect(main().getByRole("heading", { name: "フォーム管理", level: 1 })).toBeInTheDocument();
  fireEvent.click(main().getByRole("button", { name: "日払い記録の設定を開く" }));
  expect(main().getByRole("heading", { name: "日払い記録の設定", level: 1 })).toBeInTheDocument();
  fireEvent.click(main().getByRole("button", { name: "フォーム一覧に戻る" }));
  expect(main().getByRole("region", { name: "フォーム一覧" })).toBeInTheDocument();
  go("記録・報告");
  expect(main().getByRole("tab", { name: /案件報告/ })).toHaveAttribute("aria-selected", "true");
});

it("サイドメニューで離れる時も未保存設定を保護し、取消で編集を続けられる", () => {
  render(<RecordFormsPreview/>);
  go("フォーム管理");
  fireEvent.click(main().getByRole("button", { name: "案件報告の設定を開く" }));
  fireEvent.change(main().getByRole("textbox", { name: "フォーム名" }), { target: { value: "変更中の名前" } });
  go("記録・報告");
  fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(main().getByRole("textbox", { name: "フォーム名" })).toHaveValue("変更中の名前");
  go("フォーム管理");
  fireEvent.click(screen.getByRole("button", { name: "破棄して移動" }));
  expect(main().getByRole("button", { name: "案件報告の設定を開く" })).toBeInTheDocument();
});

it("新しいフォームは確定前に一覧へ追加せず、作成後は管理画面と記録側から使える", () => {
  render(<RecordFormsPreview/>);
  go("フォーム管理");
  const start = () => {
    fireEvent.click(main().getByRole("button", { name: "フォームを追加" }));
    fireEvent.click(main().getByRole("button", { name: /シンプルなメモ.*このひな形を使う/ }));
  };
  start();
  fireEvent.click(main().getByRole("button", { name: "フォーム一覧に戻る" }));
  expect(main().queryByRole("button", { name: "引き継ぎメモのコピーの設定を開く" })).not.toBeInTheDocument();
  start();
  fireEvent.change(main().getByRole("textbox", { name: "フォーム名" }), { target: { value: "連絡メモ" } });
  fireEvent.click(main().getByRole("button", { name: "フォームを作成" }));
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  expect(main().getByRole("button", { name: "連絡メモの設定を開く" })).toBeInTheDocument();
  go("記録・報告");
  fireEvent.click(main().getByRole("tab", { name: /連絡メモ/ }));
  fireEvent.click(main().getByRole("button", { name: "記録を追加" }));
  expect(main().getByText("連絡メモ · v1")).toBeInTheDocument();
  expect(main().getByRole("button", { name: "連絡メモの一覧に戻る" })).toBeInTheDocument();
});

it("管理画面で役割を変えると記録側へ戻り、非管理者にはフォーム管理を表示しない", () => {
  render(<RecordFormsPreview/>);
  go("フォーム管理");
  fireEvent.click(screen.getByRole("button", { name: "表示する役割" }));
  fireEvent.click(screen.getByRole("button", { name: "経理担当" }));
  expect(main().getByRole("heading", { name: "記録・報告", level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "フォーム管理" })).not.toBeInTheDocument();
  expect(main().getByRole("tab", { name: /日払い記録/ })).toHaveAttribute("aria-selected", "true");
  expect(main().queryByRole("tab", { name: /案件報告/ })).not.toBeInTheDocument();
});
