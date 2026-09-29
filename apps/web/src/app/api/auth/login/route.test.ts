// @vitest-environment node
import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
const req = (body: object) => new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify(body) });
it("旧PINログインは410になる", async () => {
  const response = await POST(req({ loginType: "driver", driverCode: "TST123456", pin: "123456" }));
  expect(response.status).toBe(410);
  expect((await response.json()).code).toBe("PIN_LOGIN_RETIRED");
});
it("管理者コードはロールにかかわらず410で廃止する", async () => {
  const response = await POST(req({ loginType: "admin", adminCode: "TST123456", password: "long-password" }));
  expect(response.status).toBe(410);
  expect((await response.json()).code).toBe("ADMIN_CODE_LOGIN_RETIRED");
});
