import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RankingTab } from "./RankingTab";
import type { EventTeamRow, DriverRow, EventMemberRow } from "./types";

// ────────────────────────────────────────────────────────────
// モック
// ────────────────────────────────────────────────────────────

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/displayName", () => ({ getDisplayName: (d: { name: string }) => d.name }));

// CustomSelect は jsdom で portal/animation が動かないのでシンプルな select に差し替え
vi.mock("@/lib/components/CustomSelect", () => ({
  CustomSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value?: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder ?? "select"}
    >
      <option value="">{placeholder ?? "選択"}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/lib/components/Skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

import { apiFetch } from "@/lib/api";
const mockApiFetch = vi.mocked(apiFetch);

// ────────────────────────────────────────────────────────────
// テストフィクスチャ
// ────────────────────────────────────────────────────────────

const teams: EventTeamRow[] = [
  { id: "t1", event_id: "ev1", name: "チームA", color: "#f00", sort_order: 1, created_at: "" },
];

const drivers: DriverRow[] = [
  { id: "d1", name: "田中", display_name: null },
  { id: "d2", name: "鈴木", display_name: null },
];

const members: EventMemberRow[] = [
  { id: "m1", team_id: "t1", driver_id: "d1" },
  { id: "m2", team_id: "t1", driver_id: "d2" },
];

const rankingResponse = {
  driverNames: { d1: "田中", d2: "鈴木" },
  individuals: [
    { driverId: "d1", teamId: "t1", autoPoints: 100, manualPoints: 0, total: 100, breakdown: [] },
    { driverId: "d2", teamId: "t1", autoPoints: 80, manualPoints: 0, total: 80, breakdown: [] },
  ],
  teams: [
    {
      teamId: "t1",
      name: "チームA",
      color: "#f00",
      memberPoints: 180,
      teamManualPoints: 0,
      total: 180,
      members: [
        { driverId: "d1", teamId: "t1", autoPoints: 100, manualPoints: 0, total: 100, breakdown: [] },
        { driverId: "d2", teamId: "t1", autoPoints: 80, manualPoints: 0, total: 80, breakdown: [] },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────
// ヘルパー
// ────────────────────────────────────────────────────────────

/** apiFetch のデフォルト実装（初期ロード用） */
function setupDefaultMocks() {
  mockApiFetch.mockImplementation((url: string) => {
    if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
    if (String(url).includes("/points")) return Promise.resolve({ entries: [] });
    return Promise.resolve({});
  });
}

function renderTab() {
  const onError = vi.fn();
  const onConfirm = vi.fn();
  render(
    <RankingTab
      eventId="ev1"
      teams={teams}
      members={members}
      drivers={drivers}
      hasPeriod={true}
      canWrite={true}
      onError={onError}
      onConfirm={onConfirm}
    />,
  );
  return { onError, onConfirm };
}

/** 初期ロードが完了するまで待機 */
async function waitForLoad() {
  await waitFor(() => expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument());
}

/**
 * 保留中の POST/DELETE を解決し、その後に走るバックグラウンド同期(silentSync)の
 * state 更新まで act() 内で flush する。テスト終了後の更新による act 警告を防ぐ。
 */
async function resolveAndSettle(resolve: () => void) {
  await act(async () => {
    resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ────────────────────────────────────────────────────────────
// テスト: 楽観的更新（加点）
// ────────────────────────────────────────────────────────────

describe("RankingTab — 楽観的更新（加点）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("加点ボタン押下直後にフォームがクリアされる", async () => {
    // POST は解決しないプロミスで保留し、楽観的更新を検証する
    let resolvePost!: () => void;
    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return new Promise((res) => { resolvePost = () => res({}); });
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [] });
    });

    renderTab();
    await waitForLoad();

    // ドライバー選択 → ポイント入力 → 加点
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "選択" }), "d1");
    await userEvent.type(screen.getByPlaceholderText("±"), "20");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    // POST 完了前の時点でフォームがクリアされていること
    expect((screen.getByPlaceholderText("±") as HTMLInputElement).value).toBe("");

    await resolveAndSettle(resolvePost);
  });

  it("加点直後（API 完了前）に手動加点リストへ即時追加される", async () => {
    let resolvePost!: () => void;
    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return new Promise((res) => { resolvePost = () => res({}); });
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [] });
    });

    renderTab();
    await waitForLoad();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "選択" }), "d1");
    await userEvent.type(screen.getByPlaceholderText("±"), "20");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    // API 完了前の時点でリストに表示されること
    expect(screen.getByText("+20 pt")).toBeInTheDocument();

    await resolveAndSettle(resolvePost);
  });

  it("加点直後（API 完了前）に個人ランキングのスコアが更新される", async () => {
    let resolvePost!: () => void;
    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return new Promise((res) => { resolvePost = () => res({}); });
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [] });
    });

    renderTab();
    await waitForLoad();

    // 加点前: 120pt は存在しない
    expect(screen.queryByText("120 pt")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "選択" }), "d1");
    await userEvent.type(screen.getByPlaceholderText("±"), "20");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    // API 完了前の時点でスコアが 120pt になること（チーム・個人欄の両方に出る）
    expect(screen.getAllByText("120 pt").length).toBeGreaterThan(0);

    await resolveAndSettle(resolvePost);
  });

  it("API 失敗時にロールバックされエラーが表示される", async () => {
    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return Promise.reject(new Error("サーバーエラー"));
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [] });
    });

    const { onError } = renderTab();
    await waitForLoad();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "選択" }), "d1");
    await userEvent.type(screen.getByPlaceholderText("±"), "20");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("加点に失敗しました", "サーバーエラー");
    });

    // ロールバック: 楽観的スコア(120pt)が消えて元に戻ること
    expect(screen.queryByText("120 pt")).not.toBeInTheDocument();
    // ロールバック: 楽観的に追加したエントリが消えていること
    expect(screen.queryByText("+20 pt")).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────
// テスト: 楽観的更新（削除）
// ────────────────────────────────────────────────────────────

describe("RankingTab — 楽観的更新（削除）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("削除確認後（API 完了前）にエントリが即時削除される", async () => {
    const existingEntry = {
      id: "mp1",
      driver_id: "d1",
      team_id: null,
      entry_date: null,
      points: 15,
      reason: "MVPボーナス",
      source: "manual",
      created_at: "",
    };

    let resolveDelete!: () => void;
    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") return new Promise((res) => { resolveDelete = () => res({}); });
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [existingEntry] });
    });

    // onConfirm はコールバックを即座に実行するよう設定
    const onConfirm = vi.fn().mockImplementation((_msg: string, cb: () => void) => cb());
    render(
      <RankingTab
        eventId="ev1"
        teams={teams}
        members={members}
        drivers={drivers}
        hasPeriod={true}
        canWrite={true}
        onError={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await waitForLoad();

    expect(screen.getByText("MVPボーナス")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "削除" }));

    // DELETE 完了前の時点でエントリが消えていること
    expect(screen.queryByText("MVPボーナス")).not.toBeInTheDocument();

    await resolveAndSettle(resolveDelete);
  });

  it("削除 API 失敗時にエントリがロールバックされる", async () => {
    const existingEntry = {
      id: "mp1",
      driver_id: "d1",
      team_id: null,
      entry_date: null,
      points: 15,
      reason: "MVPボーナス",
      source: "manual",
      created_at: "",
    };

    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") return Promise.reject(new Error("削除失敗"));
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [existingEntry] });
    });

    const onConfirm = vi.fn().mockImplementation((_msg: string, cb: () => void) => cb());
    const onError = vi.fn();
    render(
      <RankingTab
        eventId="ev1"
        teams={teams}
        members={members}
        drivers={drivers}
        hasPeriod={true}
        canWrite={true}
        onError={onError}
        onConfirm={onConfirm}
      />,
    );
    await waitForLoad();

    await userEvent.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("削除に失敗しました", "削除失敗");
    });

    // ロールバック: エントリが復元されること
    expect(screen.getByText("MVPボーナス")).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────
// テスト: チーム加点
// ────────────────────────────────────────────────────────────

describe("RankingTab — チーム加点", () => {
  beforeEach(() => vi.clearAllMocks());

  it("チーム加点直後（API 完了前）にチーム合計へ即時反映される", async () => {
    let resolvePost!: () => void;
    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return new Promise((res) => { resolvePost = () => res({}); });
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [] });
    });

    renderTab();
    await waitForLoad();

    // 加点前: チームA = 180pt
    expect(screen.getByText("180 pt")).toBeInTheDocument();

    // 対象を「チーム」に切替 → チームA を選択 → +50
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "select" }), "team");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "選択" }), "t1");
    await userEvent.type(screen.getByPlaceholderText("±"), "50");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    // API 完了前の時点でチーム合計が 230pt になること
    expect(screen.getByText("230 pt")).toBeInTheDocument();
    // チーム手動加点の行が表示されること
    expect(screen.getByText("チーム手動加点")).toBeInTheDocument();

    await resolveAndSettle(resolvePost);
  });

  it("チーム未選択でエラーが表示される", async () => {
    setupDefaultMocks();
    const { onError } = renderTab();
    await waitForLoad();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "select" }), "team");
    await userEvent.type(screen.getByPlaceholderText("±"), "10");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    expect(onError).toHaveBeenCalledWith("入力エラー", expect.stringContaining("チーム"));
  });
});

// ────────────────────────────────────────────────────────────
// テスト: 表示制御
// ────────────────────────────────────────────────────────────

describe("RankingTab — 表示制御", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("hasPeriod=false のとき期間設定を促す警告のみ表示される", () => {
    render(
      <RankingTab
        eventId="ev1"
        teams={teams}
        members={members}
        drivers={drivers}
        hasPeriod={false}
        canWrite={true}
        onError={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("開始日・終了日")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加点" })).not.toBeInTheDocument();
    // 期間未設定時は API を呼ぶがランキング UI は出さない
    expect(screen.queryByText("チーム対抗")).not.toBeInTheDocument();
  });

  it("canWrite=false のとき加点フォームと削除ボタンが表示されない", async () => {
    const existingEntry = {
      id: "mp1",
      driver_id: "d1",
      team_id: null,
      entry_date: null,
      points: 15,
      reason: "MVPボーナス",
      source: "manual",
      created_at: "",
    };
    mockApiFetch.mockImplementation((url: string) => {
      if (String(url).includes("/ranking")) return Promise.resolve(rankingResponse);
      return Promise.resolve({ entries: [existingEntry] });
    });

    render(
      <RankingTab
        eventId="ev1"
        teams={teams}
        members={members}
        drivers={drivers}
        hasPeriod={true}
        canWrite={false}
        onError={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    await waitForLoad();

    expect(screen.queryByRole("button", { name: "加点" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
    // 閲覧自体は可能（既存エントリは表示される）
    expect(screen.getByText("MVPボーナス")).toBeInTheDocument();
  });

  it("ランキング API が期間エラーを返したら警告表示に切り替わる", async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (String(url).includes("/ranking")) return Promise.reject(new Error("期間が未設定です"));
      return Promise.resolve({ entries: [] });
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText("開始日・終了日")).toBeInTheDocument();
    });
  });
});

// ────────────────────────────────────────────────────────────
// テスト: バックグラウンド同期
// ────────────────────────────────────────────────────────────

describe("RankingTab — バックグラウンド同期", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST 成功後にサーバーデータで静かに置き換わる（ローディング表示なし）", async () => {
    // サーバー側で計算された確定値（楽観値 120 と異なる 125 を返す）
    const serverRanking = {
      ...rankingResponse,
      individuals: [
        { driverId: "d1", teamId: "t1", autoPoints: 100, manualPoints: 25, total: 125, breakdown: [] },
        { driverId: "d2", teamId: "t1", autoPoints: 80, manualPoints: 0, total: 80, breakdown: [] },
      ],
    };
    let postDone = false;
    mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        postDone = true;
        return Promise.resolve({});
      }
      if (String(url).includes("/ranking")) {
        return Promise.resolve(postDone ? serverRanking : rankingResponse);
      }
      return Promise.resolve({ entries: [] });
    });

    renderTab();
    await waitForLoad();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "選択" }), "d1");
    await userEvent.type(screen.getByPlaceholderText("±"), "20");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    // silentSync 完了後はサーバー確定値（125pt）に置き換わる
    await waitFor(() => {
      expect(screen.getAllByText("125 pt").length).toBeGreaterThan(0);
    });
    // ローディングスケルトンは一度も出ない（silent であること）
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────
// テスト: バリデーション
// ────────────────────────────────────────────────────────────

describe("RankingTab — 入力バリデーション", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("ポイントが 0 のときエラーが表示される", async () => {
    const { onError } = renderTab();
    await waitForLoad();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "選択" }), "d1");
    await userEvent.type(screen.getByPlaceholderText("±"), "0");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    expect(onError).toHaveBeenCalledWith("入力エラー", expect.stringContaining("0 以外"));
  });

  it("ドライバー未選択でエラーが表示される", async () => {
    const { onError } = renderTab();
    await waitForLoad();

    await userEvent.type(screen.getByPlaceholderText("±"), "10");
    await userEvent.click(screen.getByRole("button", { name: "加点" }));

    expect(onError).toHaveBeenCalledWith("入力エラー", expect.stringContaining("ドライバー"));
  });
});
