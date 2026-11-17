// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const m=vi.hoisted(()=>({from:vi.fn(),finalize:vi.fn(),reports:[] as any[]}));
vi.mock("@/server/db/client",()=>({supabase:{from:m.from}}));
vi.mock("@/server/reports/finalization",()=>({finalizeReportDay:m.finalize}));
import {GET} from "./route";
const req=(authorization?:string)=>new NextRequest("http://localhost/api/cron/finalize-reports",{headers:authorization?{authorization}:{}});
beforeEach(()=>{vi.stubEnv("CRON_SECRET","isolated-test-secret");m.from.mockReset();m.finalize.mockReset().mockResolvedValue(1);m.reports=[];
 m.from.mockImplementation(()=>{const q:any={};for(const method of ["select","not","is","eq","lt","order","range"])q[method]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:m.reports,error:null}).then(resolve);return q;});
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it("未設定・別のシークレットではDBへ到達しない",async()=>{expect((await GET(req("Bearer wrong"))).status).toBe(401);vi.stubEnv("CRON_SECRET","");expect((await GET(req())).status).toBe(503);expect(m.from).not.toHaveBeenCalled();});
it("同日複数便を1回で固定し、別会社はそれぞれのスコープで処理する",async()=>{
 m.reports=[{org_id:"a",driver_id:"self",report_date:"2026-11-16"},{org_id:"a",driver_id:"self",report_date:"2026-11-16"},{org_id:"b",driver_id:"peer",report_date:"2026-11-15"}];
 const r=await GET(req("Bearer isolated-test-secret"));expect(r.status).toBe(200);expect(m.finalize.mock.calls).toEqual([["a","self","2026-11-16"],["b","peer","2026-11-15"]]);
});
it("一部失敗は500で返し、他の確定を完了し次回の再実行対象を残す",async()=>{
 m.reports=[{org_id:"a",driver_id:"self",report_date:"2026-11-16"},{org_id:"b",driver_id:"peer",report_date:"2026-11-15"}];m.finalize.mockRejectedValueOnce({code:"40001"});
 const r=await GET(req("Bearer isolated-test-secret"));expect(r.status).toBe(500);expect(await r.json()).toMatchObject({finalized:1,failures:[{date:"2026-11-16",code:"40001"}]});expect(m.finalize).toHaveBeenCalledTimes(2);
});

it("実行時間が近づいたら未処理を次回へ残す",async()=>{
 m.reports=[{org_id:"a",driver_id:"self",report_date:"2026-11-16"},{org_id:"a",driver_id:"peer",report_date:"2026-11-16"}];
 vi.spyOn(Date,"now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(26000);
 const r=await GET(req("Bearer isolated-test-secret"));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({finalized:1,remaining:1});expect(m.finalize).toHaveBeenCalledTimes(1);
});
