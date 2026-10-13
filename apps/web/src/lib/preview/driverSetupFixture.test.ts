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
