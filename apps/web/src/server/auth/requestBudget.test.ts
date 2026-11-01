// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@/server/db/client",()=>({supabase:{rpc}}));
import { consumeAuthBudget, authLimitResponse } from "./requestBudget";
beforeEach(()=>{vi.stubEnv("JWT_SECRET","fixture-budget-secret");vi.stubEnv("VERCEL","");rpc.mockReset().mockResolvedValue({data:true,error:null});});
afterEach(()=>vi.unstubAllEnvs());
it("電話番号はHMACにし自己申告の転送IPを使わない",async()=>{
 await consumeAuthBudget("sms-send","+819000000001",new NextRequest("http://localhost",{headers:{"x-forwarded-for":"1.2.3.4","x-vercel-forwarded-for":"5.6.7.8"}}));
 expect(rpc).toHaveBeenCalledWith("consume_auth_request_budget",{p_kind:"sms-send",p_subject:expect.stringMatching(/^[a-f0-9]{64}$/),p_ip:null});
 expect(JSON.stringify(rpc.mock.calls)).not.toContain("819000000001");
});
it("Vercel環境だけ信頼済みIPを匿名化して渡す",async()=>{vi.stubEnv("VERCEL","1");await consumeAuthBudget("sms-check","+819000000001",new NextRequest("http://localhost",{headers:{"x-vercel-forwarded-for":"2001:db8::1"}}));expect(rpc.mock.calls[0][1].p_ip).toMatch(/^[a-f0-9]{64}$/);});
it("上限は429、DB障害は503で閉じる",async()=>{
 for(const [response,status] of [[{data:false,error:null},429],[{data:null,error:{}},503],[{data:"true",error:null},503]] as const){rpc.mockResolvedValue(response);try{await consumeAuthBudget("sms-send","+819000000001");throw Error("not limited");}catch(error){expect(authLimitResponse(error)?.status).toBe(status);}}
});
