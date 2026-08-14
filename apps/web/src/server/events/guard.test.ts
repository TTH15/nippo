import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// テナント越境ガードの回帰テスト（2026-08-14 監査）。
// events のサブリソース（teams/members/points）は org_id を持たず event_id 経由で
// しかテナントに紐付かないため、eventBelongsToOrg が
// 「id と org_id の両方で絞って照合していること」を CI で恒久的に保証する。
// ============================================================

const fixture = {
  events: [
    { id: "e-orgA", org_id: "orgA" },
    { id: "e-orgB", org_id: "orgB" },
  ],
};

vi.mock("@/server/db/client", () => {
  return {
    supabase: {
      from: (table: string) => {
        if (table !== "events") throw new Error(`unexpected table: ${table}`);
        const filters: Record<string, string> = {};
        const chain = {
          select: () => chain,
          eq: (col: string, v: string) => {
            filters[col] = v;
            return chain;
          },
          maybeSingle: () => {
            const match = fixture.events.find((e) =>
              Object.entries(filters).every(([col, v]) => (e as Record<string, string>)[col] === v),
            );
            return Promise.resolve({ data: match ?? null, error: null });
          },
        };
        return chain;
      },
    },
  };
});

import { eventBelongsToOrg } from "./guard";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("eventBelongsToOrg", () => {
  it("自orgのイベントは true", async () => {
    await expect(eventBelongsToOrg("e-orgA", "orgA")).resolves.toBe(true);
  });

  it("他orgのイベントIDを直指定しても false（越境の遮断）", async () => {
    await expect(eventBelongsToOrg("e-orgB", "orgA")).resolves.toBe(false);
  });

  it("存在しないイベントは false", async () => {
    await expect(eventBelongsToOrg("nope", "orgA")).resolves.toBe(false);
  });

  it("eventId 空は照会せず false", async () => {
    await expect(eventBelongsToOrg("", "orgA")).resolves.toBe(false);
  });
});
