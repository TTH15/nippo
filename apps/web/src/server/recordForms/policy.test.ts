import { describe, it, expect } from "vitest";
import { makeTemplate } from "@/lib/recordForms/model";
import {
  grantFor,
  canRead,
  canEdit,
  visibleSchema,
  type Actor,
} from "./policy";
const actor: Actor = {
  id: "me",
  orgId: "a",
  roleId: "role",
  name: "本人",
  manager: false,
  worksAsDriver: true,
};
const form = () => ({
  ...makeTemplate("case", "form"),
  access: { role: "none" as const },
});
describe("フォーム単位の公開範囲", () => {
  it("ロール設定なしは運営でも拒否", () => {
    expect(Object.values(grantFor(form(), actor, "staff")).some(Boolean)).toBe(
      false,
    );
  });
  it("管理者でも自分用画面はドライバーの公開範囲になる", () => {
    expect(grantFor(form(), { ...actor, manager: true }, "self").readAll).toBe(
      false,
    );
    expect(grantFor(form(), { ...actor, manager: true }, "staff").editAll).toBe(
      true,
    );
  });
  it("本人の閲覧と対象者の閲覧は独立", () => {
    const g = grantFor(form(), actor, "self");
    expect(canRead(g, "me", "me", null)).toBe(true);
    expect(canRead(g, "me", "other", "me")).toBe(false);
    expect(canEdit(g, "me", "me")).toBe(false);
  });
  it("本人公開を停止すると既存の記録も閉じる", () => {
    const f = form();
    f.driver.readOwn = false;
    const g = grantFor(f, actor, "self");
    expect(canRead(g, "me", "me", null)).toBe(false);
  });
  it("ドライバーでないメンバーには本人公開を適用しない", () => {
    expect(
      Object.values(
        grantFor(form(), { ...actor, worksAsDriver: false }, "self"),
      ).some(Boolean),
    ).toBe(false);
  });
  it("閲覧ロールの入力・編集を拒否", () => {
    const g = grantFor({ ...form(), access: { role: "view" } }, actor, "staff");
    expect(g.readAll).toBe(true);
    expect(g.create).toBe(false);
    expect(canEdit(g, "me", "me")).toBe(false);
  });
  it("権限設定は管理者以外に返さない", () => {
    expect(visibleSchema(form(), false).access).toEqual({});
  });
});
