// @vitest-environment node
import { expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/server/auth",()=>({requireAuth:async()=>({driverId:"self"}),isAuthError:()=>false}));
import {POST} from "./route";
it("旧送信口は旧表や通知を書き換えず、現在の日報画面へ戻す",async()=>{
 const r=await POST(new NextRequest("http://localhost/api/reports",{method:"POST",body:"{}"}));
 expect(r.status).toBe(410);expect(await r.json()).toMatchObject({redirectTo:"/submit"});
});
