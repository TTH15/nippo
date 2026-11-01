// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ members: [] as {id:string;role:string}[], platform: false, offline: false, approved: false, caps: vi.fn(), filters: [] as unknown[] }));
vi.mock("@/server/auth/permissions", () => ({ resolveCapabilities: m.caps }));
vi.mock("@/server/db/client", () => ({ supabase: { from: (table:string) => {
  const q:any = { select:()=>q, eq:(...args:unknown[])=>{m.filters.push(args);return q;},
    maybeSingle: async()=>({data:table==="platform_admins" ? m.platform ? {identity_id:"person"}:null : m.approved ? {id:"00000000-0000-4000-8000-000000000001",expires_at:new Date(Date.now()+60_000).toISOString()}:null,error:m.offline?{}:null}),
    then:(resolve:any)=>Promise.resolve({data:m.members,error:m.offline?{}:null}).then(resolve) };return q;
} } }));
import { passkeyManagementAuthorization, recoverySessionHash } from "./passkeyPolicy";
import { freshStrongAuth, issueRecentAuthGrant } from "./recentAuth";
const user={driverId:"self",identityId:"person",orgId:"org",role:"DRIVER",companyCode:"A",tokenVersion:2,sessionId:"00000000-0000-4000-8000-000000000002"};
const request=(grant?:string,recovery=false)=>new NextRequest("http://localhost/api/auth/webauthn/register/verify",{headers:{authorization:"Bearer session",...(grant?{"x-reauth-token":grant}:{}),...(recovery?{"x-recovery-request":"00000000-0000-4000-8000-000000000001"}:{})}});
beforeEach(()=>{vi.stubEnv("JWT_SECRET","fixture-passkey-policy");m.members=[{id:"self",role:"DRIVER"}];m.platform=false;m.offline=false;m.approved=false;m.filters=[];m.caps.mockReset().mockResolvedValue(new Set());});
afterEach(()=>vi.unstubAllEnvs());
it("業務だけの人は直近SMSで鍵を追加できる",async()=>{expect(await passkeyManagementAuthorization(request(),{...user,...freshStrongAuth("sms")})).toEqual({});});
it("別所属が運営の場合もSMSだけで運営キーを追加・削除させない",async()=>{
 m.members.push({id:"other-membership",role:"ADMIN"});m.caps.mockImplementation(async(id:string)=>new Set(id==="other-membership"?["can_manage_members"]:[]));
 for(const recovery of [false,true])expect((await passkeyManagementAuthorization(request(),{...user,...freshStrongAuth("sms")},recovery) as NextResponse).status).toBe(403);
 expect(await passkeyManagementAuthorization(request(),{...user,...freshStrongAuth("passkey")})).toEqual({});
});
it("SMSとパスキーの再確認証明を区別する",async()=>{
 m.platform=true;
 const sms=await issueRecentAuthGrant(request(),user,"sms"),passkey=await issueRecentAuthGrant(request(),user,"passkey");
 expect((await passkeyManagementAuthorization(request(sms),user) as NextResponse).status).toBe(403);
 expect(await passkeyManagementAuthorization(request(passkey),user)).toEqual({});
});
it("承認は本人・所属・世代・申請セッションに拘束され、鍵追加にだけ使える",async()=>{
 m.platform=true;m.approved=true;const fresh={...user,...freshStrongAuth("sms")};
 expect(await passkeyManagementAuthorization(request(undefined,true),fresh,true)).toEqual({recoveryId:"00000000-0000-4000-8000-000000000001"});
 expect(m.filters).toContainEqual(["org_id","org"]);expect(m.filters).toContainEqual(["identity_id","person"]);expect(m.filters).toContainEqual(["driver_id","self"]);expect(m.filters).toContainEqual(["token_version",2]);expect(m.filters).toContainEqual(["session_hash",recoverySessionHash(request(),user)]);
 expect((await passkeyManagementAuthorization(request(undefined,true),fresh,false) as NextResponse).status).toBe(403);
});
it("権限の読み取り失敗ではSMSへ条件を緩和しない",async()=>{m.offline=true;expect((await passkeyManagementAuthorization(request(),{...user,...freshStrongAuth("sms")}) as NextResponse).status).toBe(503);});
