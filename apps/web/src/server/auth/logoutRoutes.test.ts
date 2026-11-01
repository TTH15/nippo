// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m=vi.hoisted(()=>({auth:vi.fn(),verify:vi.fn(),rpc:vi.fn()}));
vi.mock("./index",()=>({requireAuth:m.auth,isAuthError:(v:unknown)=>v instanceof NextResponse,authProvider:{verify:m.verify}}));
vi.mock("@/server/db/client",()=>({supabase:{rpc:m.rpc}}));
vi.mock("@/server/afterSafely",()=>({afterSafely:vi.fn()}));
vi.mock("@/server/notifications/dispatch",()=>({deliverStoredNotifications:vi.fn()}));
import { logout } from "./logoutRoutes";
const user={driverId:"self",identityId:"person",orgId:"org",role:"DRIVER",companyCode:"A",tokenVersion:4,sessionId:"00000000-0000-4000-8000-000000000001",sessionExpiresAt:Math.floor(Date.now()/1000)+3600};
const req=(body={})=>new NextRequest("http://localhost/api/auth/logout",{method:"POST",headers:{authorization:"Bearer fixture"},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue(user);m.rpc.mockResolvedValue({data:{ok:true},error:null});});
it("失効対象は署名済みセッション由来だけを使う",async()=>{
 expect((await logout()(req({driverId:"other",identityId:"other",sessionId:"other"}))).status).toBe(200);
 expect(m.rpc).toHaveBeenCalledWith("revoke_auth_sessions",expect.objectContaining({p_driver_id:"self",p_identity_id:"person",p_org_id:"org",p_version:4,p_all:false,p_sessions:[{id:user.sessionId,expiresAt:new Date(user.sessionExpiresAt*1000).toISOString()}]}));
});
it("他人の運営トークンを失効対象に混ぜず、本人の運営トークンは失効する",async()=>{
 m.verify.mockResolvedValueOnce({...user,purpose:"admin",driverId:"other"});await logout()(req({adminToken:"other-admin"}));expect(m.rpc.mock.calls[0][1].p_sessions).toHaveLength(1);
 m.verify.mockResolvedValueOnce({...user,purpose:"admin",sessionId:"00000000-0000-4000-8000-000000000002"});await logout()(req({adminToken:"self-admin"}));expect(m.rpc.mock.calls[1][1].p_sessions).toHaveLength(2);
});
it("全端末の失効には直近本人確認が必要",async()=>{
 expect((await logout(true)(req())).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();
 m.auth.mockResolvedValue({...user,strongAuthAt:Math.floor(Date.now()/1000),strongAuthMethod:"sms"});expect((await logout(true)(req())).status).toBe(200);expect(m.rpc.mock.calls[0][1].p_all).toBe(true);
});
it("DB障害は成功扱いせず503にする",async()=>{m.rpc.mockResolvedValue({data:null,error:{}});expect((await logout()(req())).status).toBe(503);});
