// ============================================================
// fixture（架空データと読み書きの定義）を、URLで指定したシナリオ・役割で動かす小さなストア。
// 画面側の useApi / apiFetch / useSWR の差し替え先（scripts/previews/kernel）から呼ばれる。
// React に依存しない純粋ロジックなので vitest で検証できる。
// ============================================================

import {
  BUILTIN_SCENARIOS,
  previewDriverFor,
  type PreviewRole,
  type ScenarioDefinition,
} from "./scenario";

export type FixtureContext = {
  scenario: string;
  role: PreviewRole;
  driver: ReturnType<typeof previewDriverFor>;
};

export type FixtureRequest = {
  /** SWRキーそのもの（"/api/admin/vehicles?limit=20&cursor=0" など） */
  key: string;
  /** クエリを除いたパス */
  path: string;
  params: URLSearchParams;
  method: string;
  /** JSON文字列なら解釈済み。無ければ空オブジェクト */
  body: Record<string, unknown>;
};

export type PreviewFixture<S> = {
  id: string;
  title: string;
  /** 本番のパス（"/admin/vehicles"）。プレビューでは "/preview/admin" を前置して開く */
  pathname: string;
  /** fixture固有のシナリオ。normal を必ず含める。loading / error は共通で自動追加される */
  scenarios: Record<string, ScenarioDefinition>;
  createState(context: FixtureContext): S;
  /** GET。undefined を返すと「プレビュー対象外」エラーになる */
  read(state: S, request: FixtureRequest, context: FixtureContext): unknown;
  /** POST/PUT/DELETE。undefined を返すと「プレビュー対象外」エラーになる。状態は直接書き換えてよい */
  write?(state: S, request: FixtureRequest, context: FixtureContext): unknown;
};

export type Resolution =
  | { status: "pending" }
  | { status: "ok"; data: unknown }
  | { status: "error"; error: Error };

export const UNSUPPORTED_MESSAGE = "この操作はプレビュー対象外です。";
export const FAILED_SAVE_MESSAGE = "保存・取得に失敗しました。入力を残したまま再試行してください。";
export const FETCH_ERROR_MESSAGE = "読み込みに失敗しました。時間をおいて再試行してください。";

export function parseRequest(key: string, init?: { method?: string; body?: unknown }): FixtureRequest {
  const [path, query = ""] = key.split("?");
  let body: Record<string, unknown> = {};
  if (typeof init?.body === "string" && init.body) {
    try {
      const parsed = JSON.parse(init.body);
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  return { key, path, params: new URLSearchParams(query), method: (init?.method ?? "GET").toUpperCase(), body };
}

export function scenariosOf(fixture: Pick<PreviewFixture<unknown>, "scenarios">): Record<string, ScenarioDefinition> {
  return { ...fixture.scenarios, ...BUILTIN_SCENARIOS };
}

export function createFixtureStore<S>(fixture: PreviewFixture<S>, location: { scenario: string; role: PreviewRole }) {
  const known = scenariosOf(fixture);
  // fixture が知らないシナリオは normal に倒す（URLの打ち間違いで真っ白にしない）
  const scenario = known[location.scenario] ? location.scenario : "normal";
  const context: FixtureContext = { scenario, role: location.role, driver: previewDriverFor(location.role) };
  let state = fixture.createState(context);
  let revision = 0;
  let failNextWrite = false;
  const cache = new Map<string, Resolution>();
  const subscribers = new Set<() => void>();

  const notify = () => {
    revision += 1;
    cache.clear();
    subscribers.forEach((subscriber) => subscriber());
  };

  const resolve = (key: string): Resolution => {
    if (scenario === "loading") return { status: "pending" };
    if (scenario === "error") return { status: "error", error: new Error(FETCH_ERROR_MESSAGE) };
    const cached = cache.get(key);
    if (cached) return cached;
    let result: Resolution;
    try {
      const data = fixture.read(state, parseRequest(key), context);
      result = data === undefined ? { status: "error", error: new Error(UNSUPPORTED_MESSAGE) } : { status: "ok", data };
    } catch (error) {
      result = { status: "error", error: error instanceof Error ? error : new Error(String(error)) };
    }
    cache.set(key, result);
    return result;
  };

  return {
    fixture,
    scenario,
    role: location.role,
    driver: context.driver,
    scenarios: known,
    get revision() {
      return revision;
    },
    subscribe(subscriber: () => void) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    getSnapshot: () => revision,
    resolve,
    async fetch(key: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
      const request = parseRequest(key, init);
      if (request.method === "GET") {
        const resolution = resolve(key);
        if (resolution.status === "pending") return new Promise(() => {});
        if (resolution.status === "error") throw resolution.error;
        return resolution.data;
      }
      if (scenario === "error") throw new Error(FAILED_SAVE_MESSAGE);
      if (failNextWrite) {
        failNextWrite = false;
        notify();
        throw new Error(FAILED_SAVE_MESSAGE);
      }
      const result = fixture.write?.(state, request, context);
      if (result === undefined) throw new Error(UNSUPPORTED_MESSAGE);
      notify();
      return result;
    },
    /** 次の書き込みだけ失敗させる（保存失敗時の表示確認用） */
    failNextWrite() {
      failNextWrite = true;
      notify();
    },
    get willFailNextWrite() {
      return failNextWrite;
    },
    reset() {
      state = fixture.createState(context);
      failNextWrite = false;
      notify();
    },
    /** 画面側の再検証（mutate）に相当。データは変えず購読者へ再描画を促す */
    invalidate: notify,
  };
}

export type FixtureStore = ReturnType<typeof createFixtureStore<unknown>>;
