// @vitest-environment node
import { beforeEach,expect,it,vi } from "vitest";
import { NextRequest,NextResponse } from "next/server";
const m=vi.hoisted(()=>({rpc:vi.fn(),denied:false}));
vi.mock("@/server/auth",()=>({requirePermission:async()=>m.denied?NextResponse.json({}, {status:403}):({driverId:"actor"}),isAuthError:(v:unknown)=>v instanceof NextResponse}));
vi.mock("@/server/db/tenant",()=>({resolveOrgId:async()=>"own-org"}));
vi.mock("@/server/db/client",()=>({supabase:{rpc:m.rpc}}));
import { POST as approve } from "./approve/route";
import { POST as reject } from "./reject/route";
const id="00000000-0000-4000-8000-000000000001";
const req=(body:unknown)=>new NextRequest("http://localhost/api/admin/daily/approve",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{m.denied=false;m.rpc.mockReset().mockResolvedValue({data:{ok:true,warnings:[]},error:null});});
it.each([approve,reject])("会社指定を信用せず、確認済み申請と版をトランザクションへ渡す",async handler=>{
 const r=await handler(req({driverId:id,date:"2026-11-16",orgId:"foreign",expectedRevision:"seen",requestIds:[id]}));
 expect(r.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith("decide_report_day",expect.objectContaining({p_org:"own-org",p_actor:"actor",p_driver:id,p_expected:"seen",p_requests:[id]}));
});
it.each(["40001","23514","23505","55P03"])("競合・設定変更 %s は409で再確認させる",async code=>{
 m.rpc.mockResolvedValue({error:{code,message:"日報が変更されています"}});expect((await approve(req({driverId:id,date:"2026-11-16"}))).status).toBe(409);
});
it("権限なし・不正な対象では保存を呼ばない",async()=>{
 m.denied=true;expect((await approve(req({driverId:id,date:"2026-11-16"}))).status).toBe(403);m.denied=false;
 expect((await approve(req({driverId:id,date:"2026-02-30"}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
});
