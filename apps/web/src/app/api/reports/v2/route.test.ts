// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m=vi.hoisted(() => ({ rpc:vi.fn(), parking:vi.fn(), parseParking:vi.fn(), stage:vi.fn(), prepareParking:vi.fn(), writeParking:vi.fn(), denied:false }));
vi.mock("@/server/auth", () => ({ requireAuth:async () => m.denied ? NextResponse.json({}, {status:401}) : ({driverId:"self"}), isAuthError:(x:unknown)=>x instanceof NextResponse }));
vi.mock("@/server/db/tenant", () => ({resolveOrgId:async()=>"own-org"}));
vi.mock("@/server/db/client", () => ({supabase:{rpc:m.rpc}}));
vi.mock("@/server/reports/parking", () => ({parseParkingReport:m.parseParking,saveParkingReport:m.parking,prepareParkingReport:m.prepareParking,writeParkingReport:m.writeParking}));
vi.mock("@/server/reports/postSubmitParking", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/reports/postSubmitParking")>(), chooseParkingStage: m.stage,
}));
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

it("以前開いた画面から担当解除済みの追加を送っても、駐車保存を行わず案内する", async () => {
  const message = "担当コースの設定を確認してください。必要な場合は運営に連絡してください";
  m.rpc.mockResolvedValue({ error: { code: "23514", message } });
  m.parseParking.mockReturnValue({ ok: true, value: {} });
  const response = await POST(request({ ...body(), parking: {} }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: message });
  expect(m.parking).not.toHaveBeenCalled();
});

const vehicle = "00000000-0000-4000-8000-000000000002";
const strictBody = () => ({ ...body(), items: [{ courseId: course, cycleNo: 1, entries: [], vehicleId: vehicle }],
  parkingPolicy: "required_map", parking: { status: "parked", vehicleId: vehicle, clientKey: "same-retry-key",
    at: "2026-11-16T19:00:00+09:00", coords: { lat: 34.7, lng: 135.5 } } });
const strictParsed = { status: "parked", clientKey: "same-retry-key", coords: { lat: 34.7, lng: 135.5 }, at: "2026-11-16T10:00:00Z" };

it.each([null,{ status: "later" },{ status: "parked", placeName: "名前のみ" }, { ...strictParsed, detectedBy: "stop" }])(
  "駐車必須のPWAではスキップ/名前だけを日報の前に拒否する (%j)", async parsed => {
    m.parseParking.mockReturnValue({ ok: true, value: parsed });
    const b = strictBody();
    const response = await POST(request({ ...b, parking: parsed ? b.parking : null }));
    expect(response.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  }
);

it("確定済み登録場所/ピンの事前確認が失敗すると日報は保存しない", async () => {
  m.parseParking.mockReturnValue({ ok: true, value: strictParsed });
  m.prepareParking.mockRejectedValue(new Error("その車庫は選べません"));
  const response = await POST(request(strictBody()));
  expect(response.status).toBe(409);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("日報保存後に駐車失敗を明示し、同じキー/内容で駐車だけ再試行できる", async () => {
  m.parseParking.mockReturnValue({ ok: true, value: strictParsed });
  m.prepareParking.mockResolvedValue({ row: {} });
  m.writeParking.mockResolvedValueOnce({ saved: false, unavailable: true }).mockResolvedValueOnce({ saved: true });
  const b = strictBody();
  let response = await POST(request(b));
  expect(await response.json()).toMatchObject({ reportSaved: true, parkingSaved: false, ok: false });
  response = await POST(request(b));
  expect(await response.json()).toMatchObject({ ok: true, parkingSaved: true });
  expect(m.rpc.mock.calls[1]).toEqual(m.rpc.mock.calls[0]);
  expect(m.parking).not.toHaveBeenCalled();
});

it("車両なしのPWAと旧クライアントは、駐車申告なしでも日報を保存する", async () => {
  expect((await POST(request({ ...body(), parkingPolicy: "required_map" }))).status).toBe(200);
  expect((await POST(request({ ...strictBody(), parking: null, parkingPolicy: undefined }))).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledTimes(2);
  expect(m.prepareParking).not.toHaveBeenCalled();
});

it("過去の日報には駐車時刻を省略できず、実際の日時を照合する", async () => {
  m.parseParking.mockReturnValue({ ok: true, value: strictParsed });
  const b = strictBody();
  const response = await POST(request({ ...b, parking: { ...b.parking, at: null } }));
  expect(response.status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});


it("駐車要否をサーバーで決め日報を先に保存し、駐車の照合・書き込みを行わない", async () => {
  const b = { ...strictBody(), parkingPolicy: "post_submit_map", parking: null };
  m.stage.mockResolvedValue("required");
  const response = await POST(request(b));
  expect(await response.json()).toMatchObject({ reportSaved: true, parkingStage: "required", parkingVehicleId: vehicle });
  expect(m.stage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ driverId: "self", orgId: "own-org" }), b.clientKey, b.reportDate, vehicle);
  expect(m.rpc).toHaveBeenCalledWith("submit_report_day", expect.objectContaining({ p_items: [{ ...b.items[0], _pwaParkingStage: "required" }] }));
  expect(m.parking).not.toHaveBeenCalled();
  expect(m.writeParking).not.toHaveBeenCalled();
});

it("PWA以外が送信控えの駐車要否を偽装しても、印を保存しない", async () => {
  const b = body();
  const response = await POST(request({ ...b, items: [{ ...b.items[0], _pwaParkingStage: "required" }] }));
  expect(response.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("submit_report_day", expect.objectContaining({ p_items: [b.items[0]] }));
  expect(m.stage).not.toHaveBeenCalled();
});
