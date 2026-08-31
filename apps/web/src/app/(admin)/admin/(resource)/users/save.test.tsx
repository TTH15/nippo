import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocked=vi.hoisted(()=>({api:vi.fn(),invalidate:vi.fn(),caps:new Set<string>(),data:{drivers:[{id:"driver-a",name:"検証 太郎",display_name:"検証",office_code:"123456",driver_code:"ACE123456",status:"active",driver_identities:[]}]},pages:null as any,courses:{courses:[]},roles:{roles:[]},mutate:vi.fn(),setSize:vi.fn()}));
vi.mock("@/lib/components/AdminLayout",()=>({AdminLayout:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock("@/lib/api",()=>({apiFetch:mocked.api,getStoredDriver:()=>({companyCode:"ACE"})}));
vi.mock("@/lib/capabilities",()=>({hasCapability:(cap:string)=>mocked.caps.has(cap)}));
vi.mock("@/lib/swr",()=>({swrFetcher:vi.fn(),invalidateApi:mocked.invalidate}));
vi.mock("swr",()=>({default:(key:string)=>({data:key.includes("courses")?mocked.courses:mocked.roles,isLoading:false})}));
vi.mock("swr/infinite",()=>({default:()=>({data:mocked.pages,isLoading:false,isValidating:false,setSize:mocked.setSize,mutate:mocked.mutate})}));
import UsersPage from "./page";
const initialLease={lease:{mode:"MONTHLY",amount:35000,valid_from:"2026-09-01"},revision:"a".repeat(32),upcoming:[]};
beforeEach(()=>{
  vi.useFakeTimers(); vi.clearAllMocks();
  mocked.caps=new Set(["can_manage_members","can_view_rewards","can_manage_rewards"]);
  mocked.pages=[{...mocked.data,hasMore:false,nextCursor:null}];
  mocked.api.mockImplementation(async(url:string,opts?:{method?:string})=>{
    if(url.includes("driver-lease")) {
      if(opts?.method==="PUT") throw Error("契約を保存できませんでした");
      return initialLease;
    }
    return {driver:mocked.data.drivers[0]};
  });
});
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers();});
async function open() {
  render(<UsersPage/>);
  await act(async()=>{fireEvent.click(screen.getAllByText("検証 太郎")[0]);});
}
const leaseWrites=()=>mocked.api.mock.calls.filter(([url,opts])=>url.includes("driver-lease")&&opts?.method==="PUT");
const profileWrites=()=>mocked.api.mock.calls.filter(([url,opts])=>url.includes("users/driver-a")&&opts?.method==="PUT");
it("実際の編集画面で基本情報だけ保存し、契約の失敗後は閉じずに再試行する",async()=>{
  await open();
  fireEvent.change(screen.getByDisplayValue("検証"),{target:{value:"更新後"}});
  fireEvent.click(screen.getByRole("button",{name:"契約"}));
  fireEvent.change(screen.getByDisplayValue("35000"),{target:{value:"38000"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"閉じる"}));});
  expect(screen.getByDisplayValue("38000")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("契約を保存できませんでした");
  expect(screen.queryByText("自動保存しました")).not.toBeInTheDocument();
  expect(profileWrites()).toHaveLength(1); expect(leaseWrites()).toHaveLength(1);
  mocked.api.mockImplementation(async(url:string,opts?:{method?:string})=>url.includes("driver-lease")&&opts?.method==="PUT"?{...initialLease,revision:"b".repeat(32)}:{driver:mocked.data.drivers[0]});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"未保存の項目を再試行"}));});
  expect(profileWrites()).toHaveLength(1); expect(leaseWrites()).toHaveLength(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(screen.getByText("自動保存しました")).toBeInTheDocument();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"閉じる"}));});
  expect(screen.queryByDisplayValue("38000")).not.toBeInTheDocument();
});
it("契約の取得失敗をリースなしとして表示・保存しない",async()=>{
  mocked.api.mockImplementation(async(url:string)=>{if(url.includes("driver-lease"))throw Error("read failed"); return {driver:mocked.data.drivers[0]};});
  await open(); expect(screen.getByText("ドライバー詳細の取得に失敗しました")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"契約"})).not.toBeInTheDocument(); expect(leaseWrites()).toHaveLength(0);
});
it("契約権限がない人の基本情報編集は契約の読込・保存を行わない",async()=>{
  mocked.caps=new Set(["can_manage_members"]); await open();
  fireEvent.change(screen.getByDisplayValue("検証"),{target:{value:"名前だけ変更"}});
  fireEvent.click(screen.getByRole("button",{name:"契約"}));
  expect(screen.getByText("リース契約の閲覧権限がありません。")).toBeInTheDocument();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"閉じる"}));});
  expect(mocked.api.mock.calls.some(([url])=>url.includes("driver-lease"))).toBe(false); expect(profileWrites()).toHaveLength(1);
});
it("新規ドライバー作成後に契約だけ失敗しても再作成しない",async()=>{
  mocked.api.mockImplementation(async(url:string,opts?:{method?:string})=>{
    if(url.includes("driver-lease")) { if(opts?.method==="PUT") throw Error("lease failed"); return {...initialLease,lease:null}; }
    return {driver:{...mocked.data.drivers[0],id:"new-driver",name:"新規 太郎"}};
  });
  render(<UsersPage/>);
  fireEvent.click(screen.getByRole("button",{name:/新規追加/}));
  const nameInput=screen.getByText("名前",{selector:"label"}).parentElement!.querySelector("input")!;
  fireEvent.change(nameInput,{target:{value:"新規 太郎"}});
  fireEvent.click(screen.getByRole("button",{name:"勤務"}));
  fireEvent.change(screen.getByPlaceholderText("000001"),{target:{value:"123456"}});
  fireEvent.change(screen.getAllByPlaceholderText("123456")[0],{target:{value:"456789"}});
  fireEvent.click(screen.getByRole("button",{name:"契約"}));
  fireEvent.click(screen.getByRole("button",{name:"月額"}));
  fireEvent.change(screen.getByPlaceholderText("35000"),{target:{value:"38000"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"追加"}));});
  expect(screen.getByDisplayValue("38000")).toBeInTheDocument();
  expect(mocked.api.mock.calls.filter(([url,opts])=>url==="/api/admin/users"&&opts?.method==="POST")).toHaveLength(1);
  mocked.api.mockImplementation(async()=>({...initialLease,revision:"b".repeat(32)}));
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"未保存の項目を再試行"}));});
  expect(mocked.api.mock.calls.filter(([url,opts])=>url==="/api/admin/users"&&opts?.method==="POST")).toHaveLength(1);
  expect(leaseWrites()).toHaveLength(2);
});
it("競合後は最新の契約を確認してから残った入力を新しいrevisionで保存する",async()=>{
  await open();
  fireEvent.click(screen.getByRole("button",{name:"契約"}));
  fireEvent.change(screen.getByDisplayValue("35000"),{target:{value:"39000"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"閉じる"}));});
  mocked.api.mockImplementation(async(_url:string,opts?:{method?:string})=>({
    ...initialLease,lease:{...initialLease.lease,amount:opts?.method==="PUT"?39000:42000},revision:"b".repeat(32),
  }));
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"最新の契約を確認"}));});
  expect(screen.getByText(/保存されている契約：月額 42,000円/)).toBeInTheDocument();
  expect(leaseWrites()).toHaveLength(1);
  expect(screen.getByDisplayValue("39000")).toBeInTheDocument();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"入力内容で保存する"}));});
  expect(JSON.parse(leaseWrites()[1][1].body)).toMatchObject({amount:39000,expected_revision:"b".repeat(32)});
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
