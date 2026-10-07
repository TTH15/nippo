import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ShiftExportData } from "@/lib/shiftExport/data";
const m = vi.hoisted(() => ({ resolve: vi.fn(), fetch: vi.fn(), refresh: vi.fn(), exportData: null as ShiftExportData | null }));
vi.mock("@/lib/api", () => ({ apiFetch: m.fetch, getStoredDriver: () => ({ id: "preview-admin", name: "サンプル管理者" }) }));
vi.mock("@/lib/useApi", () => ({ useApi: (key: string | null) => ({ data: key ? m.resolve(key) : undefined, isInitialLoading: false, isLoading: false, mutate: m.refresh, refresh: m.refresh }) }));
vi.mock("@/lib/capabilities", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/lib/realtime/cellCursors", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/lib/swr", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("swr", () => ({ preload: vi.fn(), mutate: vi.fn() }));
vi.mock("@/server/shiftRequests/diff", () => ({ summarizeHistory: () => [] }));
vi.mock("@/lib/components/AdminLayout", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
// 画像化は省略するが、本番ページから出力へ渡る配置・未割当のデータを検査する。
vi.mock("./ShiftExportDialog", () => ({ ShiftExportDialog: ({ data }: { data: ShiftExportData }) => { m.exportData = data; return <div data-testid="export-preview" />; } }));
import ShiftsPage from "./page";
import { createFixtureStore } from "@/lib/preview/fixtureStore";
import { shiftsFixture } from "../../../../../../../../scripts/previews/fixtures/shifts";

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  localStorage.clear();
  vi.setSystemTime(new Date("2026-08-12T12:00:00+09:00"));
  Element.prototype.scrollIntoView = vi.fn();
  m.exportData = null;
  const store = createFixtureStore(shiftsFixture, { scenario: "period-roster", role: "admin" });
  m.resolve.mockImplementation((key: string) => { const r = store.resolve(key); return r.status === "ok" ? r.data : undefined; });
  m.fetch.mockImplementation((key: string, init?: RequestInit) => store.fetch(key, init));
  m.refresh.mockResolvedValue(undefined);
});

it("終了者の無効C1・廃止コースを表と出力に残し、未割当へ誤分類しない", async () => {
  render(<ShiftsPage />);
  const table = await screen.findByRole("table", { name: "ドライバー別シフト表" });
  const endedRow = within(table).getByText("鈴木").closest("tr")!;
  expect(within(endedRow).getAllByText("過去コース")).toHaveLength(15);
  expect(within(endedRow).getAllByText("C1")).toHaveLength(15);
  expect(within(table).queryByText("佐藤")).not.toBeInTheDocument();
  const unassignedRow = within(table).getByText("未割当", { exact: true }).closest("tr")!;
  expect(unassignedRow).not.toHaveTextContent("鈴木");
  fireEvent.click(screen.getByRole("button", { name: "シフトを画像保存・エクスポート" }));
  fireEvent.click(screen.getByRole("button", { name: "シフト表の画像" }));
  await screen.findByTestId("export-preview");
  const ended = m.exportData!.rows.find(r => r.name === "鈴木")!;
  expect(ended.cells[0]).toMatchObject({ kind: "courses", courses: [{ label: "過去コース C1" }] });
  expect(m.exportData!.unassigned.every(names => !names.includes("鈴木"))).toBe(true);
});

it("表示で過去便を保持しても、追加候補へ無効C1を増やさない", async () => {
  render(<ShiftsPage />);
  const table = await screen.findByRole("table", { name: "ドライバー別シフト表" });
  const row = within(table).getByText("田中").closest("tr")!;
  fireEvent.click(within(row).getAllByRole("button", { name: "＋" })[0]);
  expect(screen.getByRole("button", { name: "＋C2" }).parentElement).toHaveTextContent("過去コース");
  expect(screen.queryByRole("button", { name: "＋C1" })).not.toBeInTheDocument();
});
