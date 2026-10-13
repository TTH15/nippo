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
