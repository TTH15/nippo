import { describe, expect, it } from "vitest";
import { createFixtureStore, parseRequest, scenariosOf, type PreviewFixture, UNSUPPORTED_MESSAGE } from "./fixtureStore";

type State = { items: { id: string; name: string }[] };

const fixture: PreviewFixture<State> = {
  id: "sample",
  title: "サンプル",
  pathname: "/admin/sample",
  scenarios: {
    normal: { label: "通常" },
    empty: { label: "0件" },
  },
  createState: ({ scenario, driver }) => ({
    items: scenario === "empty" ? [] : [{ id: "1", name: `${driver.name}の品` }],
  }),
  read: (state, request) => {
    if (request.path === "/api/items") return { items: state.items, limit: request.params.get("limit") };
    return undefined;
  },
  write: (state, request) => {
    if (request.path === "/api/items" && request.method === "POST") {
      const item = { id: String(state.items.length + 1), name: String(request.body.name) };
      state.items.push(item);
      return { item };
    }
    return undefined;
  },
};

describe("createFixtureStore", () => {
  it("normal はfixtureの read を返し、キーごとにキャッシュする", () => {
    const store = createFixtureStore(fixture, { scenario: "normal", role: "admin" });
    const first = store.resolve("/api/items?limit=20");
    expect(first).toEqual({ status: "ok", data: { items: [{ id: "1", name: "サンプル管理者の品" }], limit: "20" } });
    expect(store.resolve("/api/items?limit=20")).toBe(first);
  });
  it("empty は createState に伝わる", () => {
    const store = createFixtureStore(fixture, { scenario: "empty", role: "viewer" });
    expect(store.resolve("/api/items")).toMatchObject({ status: "ok", data: { items: [] } });
    expect(store.driver.role).toBe("ADMIN_VIEWER");
  });
  it("未知のシナリオは normal に倒す", () => {
    const store = createFixtureStore(fixture, { scenario: "nope", role: "admin" });
    expect(store.scenario).toBe("normal");
  });
  it("loading は解決しない、error は失敗する", async () => {
    const loading = createFixtureStore(fixture, { scenario: "loading", role: "admin" });
    expect(loading.resolve("/api/items")).toEqual({ status: "pending" });
    const error = createFixtureStore(fixture, { scenario: "error", role: "admin" });
    expect(error.resolve("/api/items").status).toBe("error");
    await expect(error.fetch("/api/items")).rejects.toThrow();
    await expect(error.fetch("/api/items", { method: "POST", body: "{}" })).rejects.toThrow();
  });
  it("対象外のキーはプレビュー対象外エラー", async () => {
    const store = createFixtureStore(fixture, { scenario: "normal", role: "admin" });
    expect(store.resolve("/api/other")).toMatchObject({ status: "error", error: new Error(UNSUPPORTED_MESSAGE) });
    await expect(store.fetch("/api/other", { method: "DELETE" })).rejects.toThrow(UNSUPPORTED_MESSAGE);
  });
  it("書き込みで状態が進み、購読者に通知される", async () => {
    const store = createFixtureStore(fixture, { scenario: "normal", role: "admin" });
    let calls = 0;
    const unsubscribe = store.subscribe(() => { calls += 1; });
    await expect(store.fetch("/api/items", { method: "POST", body: JSON.stringify({ name: "新品" }) })).resolves.toEqual({ item: { id: "2", name: "新品" } });
    expect(calls).toBe(1);
    expect(store.resolve("/api/items")).toMatchObject({ status: "ok", data: { items: [{ id: "1", name: "サンプル管理者の品" }, { id: "2", name: "新品" }] } });
    unsubscribe();
    store.reset();
    expect(calls).toBe(1);
    expect(store.resolve("/api/items")).toMatchObject({ status: "ok", data: { items: [{ id: "1", name: "サンプル管理者の品" }] } });
  });
  it("failNextWrite は次の1回だけ失敗させる", async () => {
    const store = createFixtureStore(fixture, { scenario: "normal", role: "admin" });
    store.failNextWrite();
    expect(store.willFailNextWrite).toBe(true);
    await expect(store.fetch("/api/items", { method: "POST", body: "{}" })).rejects.toThrow("保存・取得に失敗しました");
    expect(store.willFailNextWrite).toBe(false);
    await expect(store.fetch("/api/items", { method: "POST", body: JSON.stringify({ name: "x" }) })).resolves.toBeTruthy();
  });
});

describe("parseRequest / scenariosOf", () => {
  it("キーをパス・クエリ・本文へ分解する", () => {
    const request = parseRequest("/api/admin/users?limit=20&cursor=0", { method: "put", body: JSON.stringify({ roleId: "r1" }) });
    expect(request.path).toBe("/api/admin/users");
    expect(request.params.get("cursor")).toBe("0");
    expect(request.method).toBe("PUT");
    expect(request.body).toEqual({ roleId: "r1" });
    expect(parseRequest("/x", { body: "not json" }).body).toEqual({});
  });
  it("共通シナリオが自動で加わる", () => {
    expect(Object.keys(scenariosOf(fixture))).toEqual(["normal", "empty", "loading", "error"]);
  });
});
