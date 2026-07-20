import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// 越境テスト（notification-flow §1-3 レイヤ6「越境テストをCIに」）。
// 統合LINE（1チャネルで全社に配信）の唯一最大のリスク＝
// 「org A の通知に org B のドライバーが混ざる」を CI で恒久的に塞ぐ。
// ============================================================

// supabase は最小のチェーン可能スタブに差し替える。
// drivers の検索結果だけをテストごとに差し替えられれば、越境検出の検証には十分。
const driversInOrg = { rows: [] as { id: string }[] };
const insertedNotifications: unknown[] = [];

vi.mock("@/server/db/client", () => {
  const chain = (result: { data: unknown; error: null }) => {
    const thenable = {
      select: () => thenable,
      eq: () => thenable,
      in: () => thenable,
      is: () => thenable,
      not: () => thenable,
      order: () => thenable,
      limit: () => thenable,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return thenable;
  };

  return {
    supabase: {
      from: (table: string) => {
        if (table === "drivers") return chain({ data: driversInOrg.rows, error: null });
        if (table === "notifications") {
          return {
            upsert: (rows: unknown[]) => {
              insertedNotifications.push(...rows);
              return chain({ data: [], error: null });
            },
            ...chain({ data: [], error: null }),
          };
        }
        return {
          insert: () => chain({ data: [], error: null }),
          ...chain({ data: [], error: null }),
        };
      },
    },
  };
});

// LINE・Web Push とも未設定扱い（配信は行わずインボックスのみ）にして、
// 検証対象を越境判定に絞る
vi.mock("@/server/line/client", () => ({
  isLineConfigured: () => false,
  multicastText: vi.fn(),
}));

vi.mock("@/server/notifications/webpush", () => ({
  isWebPushConfigured: () => false,
  sendWebPush: vi.fn(),
}));

const { dispatchNotifications, detectForeignRecipients } = await import("./dispatch");

const ORG_A = "00000000-0000-0000-0000-00000000000a";

function input(driverId: string) {
  return {
    driverId,
    identityId: `identity-${driverId}`,
    kind: "broadcast",
    title: "件名",
    body: "本文",
  };
}

beforeEach(() => {
  driversInOrg.rows = [];
  insertedNotifications.length = 0;
});

describe("detectForeignRecipients（越境判定の純粋部分）", () => {
  it("許可リストに無い受信者を検出する", () => {
    expect(detectForeignRecipients(["a", "b", "x"], ["a", "b"])).toEqual(["x"]);
  });

  it("全員が許可リスト内なら空", () => {
    expect(detectForeignRecipients(["a", "b"], ["a", "b", "c"])).toEqual([]);
  });

  it("重複入力は1回だけ報告する", () => {
    expect(detectForeignRecipients(["x", "x"], ["a"])).toEqual(["x"]);
  });

  it("許可リストが空なら全員が越境", () => {
    expect(detectForeignRecipients(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("dispatchNotifications のテナント越境防止", () => {
  it("org 外の受信者が1人でも混ざるとバッチ全体を中断する", async () => {
    // org A には driver-a1 しか居ないのに、org B の driver-b1 が混ざった状況
    driversInOrg.rows = [{ id: "driver-a1" }];

    await expect(
      dispatchNotifications(ORG_A, [input("driver-a1"), input("driver-b1")]),
    ).rejects.toThrow(/越境/);
  });

  it("中断時は通知を1件も作らない（部分送信しない）", async () => {
    driversInOrg.rows = [{ id: "driver-a1" }];

    await expect(
      dispatchNotifications(ORG_A, [input("driver-a1"), input("driver-b1")]),
    ).rejects.toThrow();

    expect(insertedNotifications).toHaveLength(0);
  });

  it("全員が自 org なら通常どおり保存へ進む", async () => {
    driversInOrg.rows = [{ id: "driver-a1" }, { id: "driver-a2" }];

    const result = await dispatchNotifications(ORG_A, [input("driver-a1"), input("driver-a2")]);

    expect(insertedNotifications).toHaveLength(2);
    // 保存行には必ず送信元 org が刻まれる（配信先はこの org_id から導出される）
    for (const row of insertedNotifications as { org_id: string }[]) {
      expect(row.org_id).toBe(ORG_A);
    }
    expect(result.created).toBe(0); // スタブは insert 結果を返さないため created は 0
  });

  it("受信者が空なら何もしない", async () => {
    const result = await dispatchNotifications(ORG_A, []);
    expect(result).toEqual({
      created: 0,
      skipped: 0,
      lineSent: 0,
      lineFailed: 0,
      webPushSent: 0,
      webPushFailed: 0,
    });
    expect(insertedNotifications).toHaveLength(0);
  });
});
