// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), rpc: vi.fn(), filters: [] as unknown[][], updates: [] as unknown[], row: { id: "self", bank_branch_name: null as string | null, bank_account_type: null as "ordinary" | "current" | "savings" | null, bank_name: null as string | null, bank_no: null as string | null, bank_holder: null as string | null }, failRead: false, race: false }));
vi.mock("@/server/auth", () => ({ requireAuth: m.auth, isAuthError: (value: unknown) => value instanceof NextResponse }));
vi.mock("@/server/identity", () => ({ resolveIdentityId: async () => "person" }));
vi.mock("@/server/db/client", () => ({ supabase: { from: m.from, rpc: m.rpc } }));
import { POST } from "./route";
import { bankBeforeHash, bankAfterHash, issueBankChangeGrant } from "@/server/auth/bankChangeAuth";
import { issueRecentAuthGrant } from "@/server/auth/recentAuth";
const user = { driverId: "self", identityId: "person", orgId: "org", role: "DRIVER", companyCode: "TEST", tokenVersion: 1 };
const bank = { bankName: "見本銀行", bankNo: "01234567", bankHolder: "ミホン タロウ" };
const req = (body: object = bank, proof?: string) => new NextRequest("http://localhost/api/me/registration", { method: "POST", headers: { authorization: "Bearer session", ...(proof ? { "x-bank-change-token": proof } : {}) }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "bank-route-test"); m.auth.mockReset().mockResolvedValue(user); m.from.mockReset(); m.rpc.mockReset().mockResolvedValue({ data: true });
  m.filters = []; m.updates = []; m.row = { id: "self", bank_branch_name: null as string | null, bank_account_type: null as "ordinary" | "current" | "savings" | null, bank_name: null, bank_no: null, bank_holder: null }; m.failRead = false; m.race = false;
  m.from.mockImplementation(() => {
    const filters: [string, unknown][] = []; let update: Record<string, unknown> | null = null;
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); m.filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); m.filters.push([key, value]); return q; },
      update: (value: Record<string, unknown>) => { update = value; if (m.race) m.row.bank_no = "7777777"; return q; },
      maybeSingle: async () => {
        if (m.failRead && !update) return { data: null, error: { message: "private bank read failure" } };
        if (update) {
          if (!filters.every(([key, value]) => (m.row as Record<string, unknown>)[key] === value)) return { data: null, error: null };
          m.updates.push(update); Object.assign(m.row, update); return { data: { id: "self" }, error: null };
        }
        return { data: { ...m.row }, error: null };
      },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }; return q;
  });
});
afterEach(() => vi.unstubAllEnvs());
const existing = () => { m.row = { id: "self", bank_branch_name: null as string | null, bank_account_type: null as "ordinary" | "current" | "savings" | null, bank_name: "以前の銀行", bank_no: "1234567", bank_holder: "ミホン タロウ" }; };
it("初回の空口座はパスキーなしで本人行だけを比較更新し、先頭0を保持する", async () => {
  expect((await POST(req({ ...bank, driverId: "other" }))).status).toBe(200);
  expect(m.row.bank_no).toBe("01234567"); expect(m.rpc).not.toHaveBeenCalled();
  expect(m.filters).toContainEqual(["id", "self"]); expect(m.filters).toContainEqual(["bank_no", null]);
});
it("未認証では銀行情報を読み書きしない", async () => {
  m.auth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  expect((await POST(req())).status).toBe(401); expect(m.from).not.toHaveBeenCalled();
});
it("登録済み・一部だけ保存済みの口座の変更は確認情報なしでは拒否する", async () => {
  for (const partial of [false, true]) {
    existing(); if (partial) m.row.bank_no = null;
    expect((await POST(req())).status).toBe(403); expect(m.updates).toHaveLength(0);
  }
});
it("SMS・パスキー管理用の確認情報は受け付けない", async () => {
  existing(); const proof = await issueRecentAuthGrant(req(), user);
  expect((await POST(req(bank, proof))).status).toBe(403); expect(m.updates).toHaveLength(0);
});
it("本人・口座変更専用の確認情報があれば比較更新する", async () => {
  existing(); const proof = await issueBankChangeGrant(req(), user, bankBeforeHash(m.row), bankAfterHash(bank));
  expect((await POST(req(bank, proof))).status).toBe(200); expect(m.updates).toHaveLength(1);
  expect(m.filters).toContainEqual(["bank_no", "1234567"]); expect(m.rpc).toHaveBeenCalledOnce();
});
it("初回登録中に他端末が登録しても無確認で上書きしない", async () => {
  m.race = true; expect((await POST(req())).status).toBe(409);
  expect(m.row.bank_no).toBe("7777777"); expect(m.updates).toHaveLength(0);
});
it("確認済みの変更でも保存直前に口座が変われば409で止める", async () => {
  existing(); const proof = await issueBankChangeGrant(req(), user, bankBeforeHash(m.row), bankAfterHash(bank)); m.race = true;
  expect((await POST(req(bank, proof))).status).toBe(409); expect(m.updates).toHaveLength(0);
});
it("読取失敗を初回登録と扱わず、口座削除やKYCとの同時変更を拒否する", async () => {
  m.failRead = true; expect((await POST(req())).status).toBe(503); expect(m.updates).toHaveLength(0);
  m.failRead = false; existing(); expect((await POST(req({ bankName: null, bankNo: null, bankHolder: null }))).status).toBe(400);
  expect((await POST(req({ ...bank, address: "別住所" }))).status).toBe(400); expect(m.updates).toHaveLength(0);
});
it("同じ登録値の再送では変更・確認情報の消費をしない", async () => {
  m.row = { id: "self", bank_branch_name: null as string | null, bank_account_type: null as "ordinary" | "current" | "savings" | null, bank_name: bank.bankName, bank_no: bank.bankNo, bank_holder: bank.bankHolder };
  expect((await POST(req())).status).toBe(200); expect(m.updates).toHaveLength(0); expect(m.rpc).not.toHaveBeenCalled();
});

it("一部だけ登録済みでも、保存済み項目を変えず空欄を埋める初回登録は確認不要", async () => {
  m.row.bank_name = bank.bankName;
  expect((await POST(req())).status).toBe(200);
  expect(m.row.bank_no).toBe(bank.bankNo); expect(m.rpc).not.toHaveBeenCalled();
  expect(m.filters).toContainEqual(["bank_name", bank.bankName]);
});

it("銀行と支店を分け、種別を保存する。未対応種別と空支店は拒否する", async () => {
  const full = { ...bank, bankBranch: "中央支店", bankType: "ordinary" as const };
  expect((await POST(req({ ...full, bankType: "fixed" }))).status).toBe(400);
  expect((await POST(req({ ...full, bankBranch: "" }))).status).toBe(400);
  expect((await POST(req(full))).status).toBe(200);
  expect(m.row).toMatchObject({ bank_name: "見本銀行 中央支店", bank_branch_name: "中央支店", bank_account_type: "ordinary" });
  expect(m.filters).toContainEqual(["bank_branch_name", null]);
  expect(m.filters).toContainEqual(["bank_account_type", null]);
});
it("既存口座の支店・種別の補完もパスキーを要求し、確認後の種別入替を拒否する", async () => {
  existing(); const full = { ...bank, bankBranch: "中央支店", bankType: "ordinary" as const };
  expect((await POST(req(full))).status).toBe(403);
  const proof = await issueBankChangeGrant(req(), user, bankBeforeHash(m.row), bankAfterHash(full));
  expect((await POST(req({ ...full, bankType: "savings" }, proof))).status).toBe(403);
  expect((await POST(req({ ...full, bankBranch: "別支店" }, proof))).status).toBe(403);
  expect((await POST(req(full, proof))).status).toBe(200);
});

it("旧形式番号の表記整理と不足名義の初回補完は許可し、番号変更は拒否する", async () => {
  m.row.bank_name = "見本銀行 中央支店"; m.row.bank_no = "普通 01234567";
  const filled = { bankName: "見本銀行", bankBranch: "中央支店", bankType: "ordinary", bankNo: "01234567", bankHolder: "ミホン" };
  expect((await POST(req({ ...filled, bankNo: "9999999" }))).status).toBe(403);
  expect((await POST(req(filled))).status).toBe(200);
  expect(m.row.bank_no).toBe("01234567"); expect(m.row.bank_account_type).toBe("ordinary"); expect(m.row.bank_name).toBe("見本銀行 中央支店");
  expect(m.filters).toContainEqual(["bank_no", "普通 01234567"]); expect(m.rpc).not.toHaveBeenCalled();
});
