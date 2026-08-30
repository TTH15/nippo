import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import RecordEditor from "./RecordEditor";
import { FormUIProvider } from "./context";
import { makeTemplate } from "./model";
afterEach(cleanup);
const form = makeTemplate("memo", "form");
const actor = { id: "actor", name: "記入者" };
const setup = (onSave: React.ComponentProps<typeof RecordEditor>["onSave"]) =>
  render(
    <FormUIProvider
      value={{
        members: [{ value: actor.id, label: actor.name }],
        roles: [],
        preview: false,
      }}
    >
      <RecordEditor
        form={form}
        record={null}
        actor={actor}
        editable
        onSave={onSave}
        onClose={vi.fn()}
      />
    </FormUIProvider>,
  );
function fill() {
  fireEvent.change(screen.getByRole("textbox", { name: /件名/ }), {
    target: { value: "残すべき件名" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /内容/ }), {
    target: { value: "保存前の内容" },
  });
}
it("通信失敗でも入力を保持し、再送に同じ記録IDを使う", async () => {
  const save = vi.fn().mockRejectedValue(new Error("通信できません"));
  setup(save);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "記録を追加" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: /件名/ })).toHaveValue(
    "残すべき件名",
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "記録を追加" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "記録を追加" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0][0].id).toBe(save.mock.calls[1][0].id);
  expect(save.mock.calls[0][0]).toMatchObject({
    formVersion: 1,
    reporter: "actor",
    answers: { title: "残すべき件名", body: "保存前の内容" },
  });
});
it("保存中は二重送信と入力の上書きを防ぐ", async () => {
  let done!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  setup(save);
  fill();
  const button = screen.getByRole("button", { name: "記録を追加" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(screen.getByRole("textbox", { name: /件名/ })).toBeDisabled();
  done();
  await waitFor(() => expect(button).toBeEnabled());
});

it("無効化されたメンバーも既存の回答の氏名を編集画面に残す", () => {
  const schema = {
    ...form,
    subjectField: "subject",
    fields: [
      ...form.fields,
      {
        id: "subject",
        type: "member" as const,
        label: "対象者",
        required: false,
      },
    ],
  };
  render(
    <FormUIProvider
      value={{
        members: [{ value: actor.id, label: actor.name }],
        roles: [],
        preview: false,
      }}
    >
      <RecordEditor
        form={schema}
        actor={actor}
        editable
        onSave={vi.fn()}
        onClose={vi.fn()}
        record={{
          id: "existing",
          formId: form.id,
          schema,
          answers: { title: "過去の記録", body: "本文", subject: "retired" },
          status: "",
          author: actor.id,
          reporter: actor.id,
          createdAt: "2026-08-31T00:00:00Z",
          history: [],
          version: 1,
          memberNames: { retired: "過去の担当者" },
        }}
      />
    </FormUIProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "編集・追記" }));
  expect(screen.getByRole("button", { name: "対象者" })).toHaveTextContent(
    "過去の担当者",
  );
});
