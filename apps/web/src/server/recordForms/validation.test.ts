import { describe, it, expect } from "vitest";
import { makeTemplate } from "@/lib/recordForms/model";
import { parseDefinition, parseAnswers } from "./validation";
const id = "11111111-1111-4111-8111-111111111111",
  member = "22222222-2222-4222-8222-222222222222";
const roles = [{ id: member, label: "管理者", manager: true }];
const definition = () => ({
  ...makeTemplate("payment", id),
  access: { [member]: "edit" as const },
});
const members = [{ value: member, label: "対象者" }];
const answers = {
  title: "支払",
  recipient: member,
  date: "2026-08-31",
  work_date: "2026-08-30",
  amount: "8500",
  method: "bank",
};
describe("汎用フォームの信頼境界", () => {
  it("実在ロールと型だけを採用する", () => {
    const form = parseDefinition(
      {
        ...definition(),
        orgId: "foreign",
        fields: definition().fields.map((f) => ({ ...f, role: "revenue" })),
      },
      roles,
    );
    expect(form).not.toHaveProperty("orgId");
    expect(form.fields[0]).not.toHaveProperty("role");
    expect(form.access[member]).toBe("edit");
  });
  it("他orgのロールを拒否", () => {
    expect(() =>
      parseDefinition({ ...definition(), access: { other: "edit" } }, roles),
    ).toThrow();
  });
  it("項目IDの重複とプロトタイプキーを拒否", () => {
    const d = definition();
    expect(() =>
      parseDefinition({ ...d, fields: [d.fields[0], d.fields[0]] }, roles),
    ).toThrow();
    expect(() =>
      parseDefinition(
        { ...d, fields: [{ ...d.fields[0], id: "__proto__" }] },
        roles,
      ),
    ).toThrow();
  });
  it("任意の状態定義を拒否", () => {
    expect(() =>
      parseDefinition(
        {
          ...definition(),
          statuses: [{ id: "paid", label: "支払済", terminal: true }],
        },
        roles,
      ),
    ).toThrow();
  });
  it("支払・稼働日を分け、金額を数値にする", () => {
    expect(parseAnswers(definition(), answers, members)).toMatchObject({
      amount: 8500,
      date: "2026-08-31",
      work_date: "2026-08-30",
    });
  });
  it.each([true, [], {}, "Infinity", "-1", "1000000000"])(
    "不正な金額 %j を拒否",
    (amount) =>
      expect(() =>
        parseAnswers(definition(), { ...answers, amount }, members),
      ).toThrow(),
  );
  it.each(["2026-02-29", "2026-02-30", "2026-13-01", "2026-8-1"])(
    "不正な日付 %s を拒否",
    (date) =>
      expect(() =>
        parseAnswers(definition(), { ...answers, date }, members),
      ).toThrow(),
  );
  it("他orgのメンバーと未定義の回答を拒否", () => {
    expect(() =>
      parseAnswers(definition(), { ...answers, recipient: id }, members),
    ).toThrow();
    expect(() =>
      parseAnswers(definition(), { ...answers, unknown: "x" }, members),
    ).toThrow();
  });
  it("その他は本文を必須にし構造を保つ", () => {
    const method = { selected: [], other: "電子マネー" };
    expect(
      parseAnswers(definition(), { ...answers, method }, members).method,
    ).toEqual(method);
    expect(() =>
      parseAnswers(
        definition(),
        { ...answers, method: { ...method, other: " " } },
        members,
      ),
    ).toThrow();
  });
  it("boolと文字列を厳密に区別", () => {
    const d = makeTemplate("memo", id);
    d.fields = [{ id: "bool", label: "確認", type: "bool", required: true }];
    expect(() => parseAnswers(d, { bool: "false" }, members)).toThrow();
    expect(parseAnswers(d, { bool: false }, members)).toEqual({ bool: false });
  });
});
