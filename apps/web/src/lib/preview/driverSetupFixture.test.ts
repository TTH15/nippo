import { expect, it } from "vitest";
import { createFixtureStore } from "./fixtureStore";
import { meFixture } from "../../../../../scripts/previews/fixtures/me";
it.each(["both-missing", "phone-missing", "no-phone"])("%sのプレビューは電話が空で、入力した番号をSMSで初回登録できる", async scenario => {
  const store = createFixtureStore(meFixture, { scenario, role: "admin" });
  expect(await store.fetch("/api/reports/profile")).toMatchObject({ phone: "", phoneVerified: false });
  await expect(store.fetch("/api/me/phone/send", { method: "POST", body: JSON.stringify({ phone: "09012345678" }) })).resolves.toEqual({ ok: true });
  await expect(store.fetch("/api/me/phone/verify", { method: "POST", body: JSON.stringify({ phone: "09012345678", code: "123456" }) })).resolves.toEqual({ ok: true });
  expect(await store.fetch("/api/reports/profile", { fresh: true })).toMatchObject({ phone: "09012345678", phoneVerified: true });
});
it("確認済み番号のシナリオは初回登録として上書きしない", async () => {
  const store = createFixtureStore(meFixture, { scenario: "normal", role: "admin" });
  await expect(store.fetch("/api/me/phone/send", { method: "POST", body: JSON.stringify({ phone: "09012345678" }) })).rejects.toThrow("登録済み");
});
it("初回口座保存は銀行・支店・種別を別項目で保持する", async () => {
  const store = createFixtureStore(meFixture, { scenario: "bank-missing", role: "admin" });
  const bank = { bankName: "見本銀行", bankBranch: "中央支店", bankType: "savings", bankNo: "01234567", bankHolder: "ミホン タロウ" };
  await store.fetch("/api/me/registration", { method: "POST", body: JSON.stringify(bank) });
  expect(await store.fetch("/api/me/registration", { fresh: true })).toMatchObject(bank);
});

it("編集開始のパスキー証明で初めて入力する口座を保存でき、同じ証明は再利用できない", async () => {
  const store = createFixtureStore(meFixture, { scenario: "normal", role: "admin" });
  const previousBank = await store.fetch("/api/me/registration") as Record<string, unknown>;
  const intent = { method: "passkey", action: "bank_edit", previousBank };
  await store.fetch("/api/auth/reauth/options", { method: "POST", body: JSON.stringify(intent) });
  const proof = await store.fetch("/api/auth/reauth/verify", { method: "POST", body: JSON.stringify(intent) }) as { bankChangeToken: string };
  const bank = { bankName: "別の銀行", bankBranch: "別の支店", bankType: "current", bankNo: "7654321", bankHolder: "ミホン タロウ" };
  const init = { method: "POST", headers: { "x-bank-change-token": proof.bankChangeToken }, body: JSON.stringify(bank) };
  await store.fetch("/api/me/registration", init);
  await expect(store.fetch("/api/me/registration", { ...init, body: JSON.stringify({ ...bank, bankNo: "9999999" }) })).rejects.toThrow("パスキー");
});

it("口座変更ページからマイページへ移っても保存した架空口座を保持し、初期化で戻す", async () => {
  const context = { scenario: "normal", role: "admin" } as const;
  const store = createFixtureStore(meFixture, context); store.reset();
  const previousBank = await store.fetch("/api/me/registration");
  const intent = { method: "passkey", action: "bank_edit", previousBank };
  await store.fetch("/api/auth/reauth/options", { method: "POST", body: JSON.stringify(intent) });
  const proof = await store.fetch("/api/auth/reauth/verify", { method: "POST", body: JSON.stringify(intent) }) as { bankChangeToken: string };
  const target = { bankName: "見本銀行", bankBranch: "配送支店", bankType: "ordinary", bankNo: "7654321", bankHolder: "ミホン タロウ" };
  await store.fetch("/api/me/registration", { method: "POST", headers: { "x-bank-change-token": proof.bankChangeToken }, body: JSON.stringify(target) });
  const returned = createFixtureStore({ ...meFixture, id: "bank-change", pathname: "/account/bank-change" }, context);
  expect(await returned.fetch("/api/me/registration")).toMatchObject(target);
  returned.reset(); expect(await returned.fetch("/api/me/registration")).toMatchObject({ bankNo: "1234567" });
});

it("管理画面で保存した独立口座を本人の変更ページでも読み、旧形式は未保存なら維持する", async () => {
 const { usersFixture } = await import("../../../../../scripts/previews/fixtures/users");
 const context = { scenario: "bank-legacy-other", role: "admin" as const };
 const admin = createFixtureStore(usersFixture, context); admin.reset();
 const old = (await admin.fetch("/api/admin/users/driver-1") as { driver: Record<string, unknown> }).driver;
 expect(old.bank_no).toBe("別段 01234567"); expect(old.bank_account_type).toBeNull();
 await admin.fetch("/api/admin/users/driver-1", { method:"PUT", body: JSON.stringify({ displayName:"見本" }) });
 expect((await admin.fetch("/api/admin/users/driver-1", { fresh:true }) as { driver: Record<string, unknown> }).driver.bank_no).toBe("別段 01234567");
 const next = { bankName:"見本銀行", bankBranch:"中央支店", bankType:"other", bankTypeOther:"別段", bankNo:"01234567", bankHolder:"ミホン タロウ" };
 await admin.fetch("/api/admin/users/driver-1", { method:"PUT", body: JSON.stringify(next) });
 const self = createFixtureStore(meFixture,context);
 expect(await self.fetch("/api/me/registration")).toMatchObject(next);
 expect((await admin.fetch("/api/admin/users/driver-1", { fresh:true }) as { driver: Record<string, unknown> }).driver).toMatchObject({ bank_name:"見本銀行", bank_branch_name:"中央支店", bank_no:"01234567", bank_account_type:"other", bank_account_type_other:"別段" });
 admin.reset();
});
