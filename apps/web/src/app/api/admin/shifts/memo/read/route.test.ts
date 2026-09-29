// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ permission: vi.fn(), from: vi.fn(), stream: vi.fn(), configured: vi.fn() }));
vi.mock("@/server/auth", () => ({ requirePermission: h.permission, isAuthError: (value: unknown) => value instanceof Response }));
vi.mock("@/server/db/client", () => ({ supabase: { from: h.from } }));
vi.mock("@/server/db/tenant", () => ({ resolveOrgId: async () => "org-a" }));
vi.mock("@/server/ai/client", () => ({ isAnthropicConfigured: h.configured, getAnthropic: () => ({ messages: { stream: h.stream } }) }));
import { POST } from "./route";

const request = (file: File, year = 2026, month = 9) => {
  const form = new FormData();
  form.set("file", file);
  form.set("year", String(year));
  form.set("month", String(month));
  return new NextRequest("http://localhost/api/admin/shifts/memo/read", { method: "POST", body: form });
};
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], "memo.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  h.configured.mockReturnValue(true);
  h.permission.mockResolvedValue({ driverId: "actor", orgId: "org-a" });
  h.from.mockReturnValue({ select: () => ({ eq: vi.fn().mockResolvedValue({ data: [{ name: "豊中", summary_title: null }], error: null }) }) });
  h.stream.mockReturnValue({ finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
    period: { year: 2026, month: 9 }, rows: [{ name: "豊中", days: [{ day: 16, names: ["佐藤"] }] }], warnings: [],
  }) }] }) });
});

it("シフト管理権限がない場合はファイルを読み取らない", async () => {
  h.permission.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await POST(request(png()))).status).toBe(403);
  expect(h.from).not.toHaveBeenCalled();
  expect(h.stream).not.toHaveBeenCalled();
  expect(h.permission).toHaveBeenCalledWith(expect.anything(), "can_manage_shifts");
});

it("ファイルの種類と中身を検査してからAIへ送る", async () => {
  expect((await POST(request(new File(["wrong"], "memo.png", { type: "image/png" })))).status).toBe(400);
  expect((await POST(request(new File(["text"], "memo.txt", { type: "text/plain" })))).status).toBe(400);
  expect(h.stream).not.toHaveBeenCalled();
});

it("会社内のコースを参照し、読み取り結果を選択月で検査する", async () => {
  const response = await POST(request(png()));
  expect(response.status).toBe(200);
  expect((await response.json()).rows[0].days[0].names).toEqual(["佐藤"]);
  expect(h.from).toHaveBeenCalledWith("courses");
  expect(h.stream).toHaveBeenCalledTimes(1);
  expect((await POST(request(png(), 2026, 10))).status).toBe(502);
});
