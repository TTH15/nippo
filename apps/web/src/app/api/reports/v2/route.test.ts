// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m=vi.hoisted(() => ({ rpc:vi.fn(), parking:vi.fn(), parseParking:vi.fn(), denied:false }));
vi.mock("@/server/auth", () => ({ requireAuth:async () => m.denied ? NextResponse.json({}, {status:401}) : ({driverId:"self"}), isAuthError:(x:unknown)=>x instanceof NextResponse }));
vi.mock("@/server/db/tenant", () => ({resolveOrgId:async()=>"own-org"}));
vi.mock("@/server/db/client", () => ({supabase:{rpc:m.rpc}}));
vi.mock("@/server/reports/parking", () => ({parseParkingReport:m.parseParking,saveParkingReport:m.parking}));
import {POST} from "./route";
const course="00000000-0000-4000-8000-000000000001";
const body=()=>({reportDate:"2026-11-16",expectedRevision:"revision",clientKey:"same-retry-key",items:[{courseId:course,cycleNo:1,entries:[]},{courseId:course,cycleNo:2,request:true,entries:[]}]});
const request=(b:unknown)=>new NextRequest("http://localhost/api/reports/v2",{method:"POST",body:JSON.stringify(b)});
beforeEach(()=>{vi.clearAllMocks();m.denied=false;m.rpc.mockResolvedValue({data:{reportIds:["r1"],requestIds:["q2"]},error:null});});
it("本人・正式日報・追加分・読取版・再送キーを同じ原子的な保存へ渡す",async()=>{
 const r=await POST(request({...body(),driverId:"another-person",orgId:"another-org"}));
 expect(r.status).toBe(200);expect(await r.json()).toMatchObject({reportIds:["r1"],requestIds:["q2"]});
 expect(m.rpc).toHaveBeenCalledWith("submit_report_day",expect.objectContaining({p_org:"own-org",p_driver:"self",p_expected:"revision",p_key:"same-retry-key",p_items:body().items}));
});
it.each(["expectedRevision","clientKey"])("%s が欠けた旧/不正フォームは書き込まない",async key=>{const b:any=body();delete b[key];expect((await POST(request(b))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
it.each(["40001","23514","23505","55P03","40P01"])("%s の競合は入力を保って再確認できる409",async code=>{m.rpc.mockResolvedValue({error:{code,message:"日報が変更されています"}});expect((await POST(request(body()))).status).toBe(409);expect(m.parking).not.toHaveBeenCalled();});
it("未認証では保存RPCへ到達しない",async()=>{m.denied=true;expect((await POST(request(body()))).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();});
it("駐車申告の失敗後も同じ再送キーを使用でき、保存済み日報を返す",async()=>{
 m.parseParking.mockReturnValue({ok:true,value:{}});m.parking.mockRejectedValue(new Error("駐車申告失敗"));
 const b={...body(),parking:{status:"later"}};const r=await POST(request(b));expect(r.status).toBe(500);expect(await r.json()).toMatchObject({reportSaved:true,reportIds:["r1"]});
 m.parking.mockResolvedValue({saved:true});expect((await POST(request(b))).status).toBe(200);
 expect(m.rpc.mock.calls.map(c=>c[1].p_key)).toEqual(["same-retry-key","same-retry-key"]);
});
