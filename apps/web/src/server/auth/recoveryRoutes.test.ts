// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m=vi.hoisted(()=>({auth:vi.fn(),platform:vi.fn(),rpc:vi.fn(),table:"",filters:[] as unknown[],role:true}));
vi.mock("./index",()=>({requireAuth:m.auth,isAuthError:(v:unknown)=>v instanceof NextResponse}));
vi.mock("@/server/platform",()=>({requirePlatformAdmin:m.platform}));
vi.mock("@/server/auth/passkeyPolicy",()=>({recoverySessionHash:()=>"a".repeat(64)}));
vi.mock("@/server/afterSafely",()=>({afterSafely:vi.fn()}));
vi.mock("@/server/notifications/dispatch",()=>({deliverStoredNotifications:vi.fn()}));
vi.mock("@/server/db/client",()=>({supabase:{rpc:m.rpc,from:(table:string)=>{m.table=table;const q:any={select:()=>q,eq:(...x:unknown[])=>{m.filters.push(x);return q;},maybeSingle:async()=>({data:table==="drivers"?{role_id:"root"}:table==="roles"?m.role?{id:"root"}:null:null,error:null})};return q;}}}));
import { ownRecovery, recoveryDecisions } from "./recoveryRoutes";
const user={driverId:"self",identityId:"person",orgId:"org",role:"ADMIN",companyCode:"A",tokenVersion:3,purpose:"admin" as const};
const req=(body:unknown)=>new NextRequest("http://localhost/api/admin/account-recovery",{method:"POST",headers:{authorization:"Bearer fixture"},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();m.role=true;m.filters=[];m.auth.mockResolvedValue({...user,strongAuthAt:Math.floor(Date.now()/1000),strongAuthMethod:"sms"});m.rpc.mockResolvedValue({data:{id:"request",status:"pending",expiresAt:"future",notificationId:"notice",orgId:"org"},error:null});});
it("復旧申請の本人・会社・世代はリクエストの指定を信用しない",async()=>{
 expect((await ownRecovery(req({identityId:"other",orgId:"other"}))).status).toBe(200);
 expect(m.rpc).toHaveBeenCalledWith("request_account_recovery",{p_driver_id:"self",p_identity_id:"person",p_org_id:"org",p_version:3,p_session_hash:"a".repeat(64)});
});
it("SMSだけでは管理者でも復旧承認できない",async()=>{expect((await recoveryDecisions()(req({id:"00000000-0000-4000-8000-000000000001",approve:true}))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
it("管理者の直近パスキー確認後だけ会社に束縛した承認RPCを呼ぶ",async()=>{
 m.auth.mockResolvedValue({...user,strongAuthAt:Math.floor(Date.now()/1000),strongAuthMethod:"passkey"});
 expect((await recoveryDecisions()(req({id:"00000000-0000-4000-8000-000000000001",approve:true,platform:true,actorIdentityId:"other"}))).status).toBe(200);
 expect(m.rpc.mock.calls[0]).toEqual(["decide_account_recovery",expect.objectContaining({p_actor_driver_id:"self",p_actor_identity_id:"person",p_actor_org_id:"org",p_actor_version:3,p_platform:false})]);
 expect(m.filters).toContainEqual(["org_id","org"]);expect(m.filters).toContainEqual(["key","ADMIN"]);expect(m.filters).toContainEqual(["is_system",true]);
});
it("管理者以外の承認を拒否する",async()=>{m.role=false;expect((await recoveryDecisions()(req({}))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
it("運営窓口にもプラットフォーム権限と直近パスキー確認を要求する",async()=>{m.platform.mockResolvedValue({user:{...user,strongAuthAt:Math.floor(Date.now()/1000),strongAuthMethod:"passkey"},identityId:"person"});expect((await recoveryDecisions(true)(req({id:"00000000-0000-4000-8000-000000000001",approve:true}))).status).toBe(200);expect(m.rpc.mock.calls[0][1].p_platform).toBe(true);});
