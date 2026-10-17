import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import ReportSourceImageField from "./ReportSourceImageField";
import type { ReportImageOutcome } from "@/lib/ocr/reportImageReader";
import type { ShiftForm } from "@repo/core/types";
const mocks=vi.hoisted(()=>({ api:vi.fn(),upload:vi.fn(),read:vi.fn(),refresh:vi.fn(),persistFails:false }));
vi.mock("@/lib/api",()=>({apiFetch:mocks.api,apiUpload:mocks.upload}));
vi.mock("@/lib/useApi",()=>({useApi:(key:string)=>({ data:key.includes("templates") ? {templates:[{key:"test",version:"1",name:"表"}]} : {images:[]},refresh:mocks.refresh })}));
vi.mock("@/lib/ocr/reportImageReader",()=>({prefetchReportImageReader:vi.fn(),releaseReaders:vi.fn(),readReportImage:mocks.read}));
vi.mock("./ReportImageReviewSheet",()=>({ReportImageReviewSheet:({rows,onConfirm,saving}:{rows:{targetFormKey?:string}[];onConfirm:()=>void;saving:boolean})=><div><p>反映先の確認</p><p>{rows[0]?.targetFormKey}</p><button onClick={onConfirm} disabled={saving}>確認して反映</button></div>}));
const shift:ShiftForm={courseId:"course",cycleNo:1,cycleLabel:"C1",courseName:"昼",color:null,carrierId:null,carrierName:"配送",existing:null,
 units:[{id:"u",name:"宅配",code:null,billingType:"PER_PIECE",fields:[{fieldKey:"done",label:"完了",inputType:"INT",required:false,groupLabel:"午前"}]}]};
function outcome():ReportImageOutcome {
 return {template:{key:"test",version:"1",name:"表",carrierId:null,definition:{fields:[],match:{required:[]}}},rotation:0,ambiguous:false,crops:{},attempts:[],
 prepared:{canvas:{toBlob:(fn:BlobCallback)=>fn(new Blob(["image"]))} as HTMLCanvasElement,width:100,height:100,rotate:0,angle:0,inverted:false},
 result:{match:{templateKey:"test",templateVersion:"1",name:"表",score:1,level:"high",accepted:true,missingRequired:[],hits:[]},fields:[{fieldId:"done",unitId:"u",fieldKey:"done",label:"完了",role:"entry",raw:"72",value:72,status:"read",box:null,anchorBox:null,confidence:99,refined:true}],readDate:"2026-10-17",warnings:[],trust:{level:"verified",checksRun:2,checksFailed:0,incomplete:false,reasons:[]}}};
}
function upload(container:HTMLElement) {fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[new File(["image"],"sample.png",{type:"image/png"})]}});}
beforeEach(()=>{
 mocks.persistFails=false;
 mocks.api.mockImplementation(async(_path:string,init?:RequestInit)=>{if(init?.method==="POST"&&mocks.persistFails) throw Error("failed"); return {templates:[{key:"test",version:"1",name:"表"}]};});
 mocks.upload.mockResolvedValue({id:"image-1",duplicate:"none",capturedAt:null,capturedAtSource:"unknown"});
 mocks.read.mockResolvedValue(outcome());mocks.refresh.mockResolvedValue(undefined);
 vi.stubGlobal("Image",class {naturalWidth=100;naturalHeight=100;onload:(()=>void)|null=null;set src(_s:string){queueMicrotask(()=>this.onload?.());}});
 vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:test");vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it("読み取り記録の保存に失敗したときは、日報の入力値を変更しない",async()=>{
 mocks.persistFails=true;const apply=vi.fn();const {container}=render(<ReportSourceImageField reportDate="2026-10-17" shifts={[shift]} courseId="course" onApply={apply}/>);
 upload(container);await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("failed"));expect(apply).not.toHaveBeenCalled();
});
it("入力済みなら検算済み画像も確認へ進み、確定するまで上書きしない",async()=>{
 const apply=vi.fn();const {container}=render(<ReportSourceImageField reportDate="2026-10-17" shifts={[shift]} courseId="course" values={{"course:1":{u:{done:"71"}}}} onApply={apply}/>);
 upload(container);await screen.findByText("反映先の確認");expect(apply).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("確認して反映"));await waitFor(()=>expect(apply).toHaveBeenCalledWith([{unitId:"u",fieldKey:"done",value:72,targetFormKey:"course:1"}]));
});
it("読取中に日付が変わった結果を、新しい日の日報へ反映しない",async()=>{
 let finish!:(value:ReportImageOutcome)=>void;mocks.read.mockReturnValue(new Promise<ReportImageOutcome>(resolve=>{finish=resolve;}));
 const apply=vi.fn();const {container,rerender}=render(<ReportSourceImageField reportDate="2026-10-17" shifts={[shift]} courseId="course" onApply={apply}/>);
 upload(container);await waitFor(()=>expect(mocks.read).toHaveBeenCalled());
 rerender(<ReportSourceImageField reportDate="2026-10-18" shifts={[shift]} courseId="course" onApply={apply}/>);
 finish(outcome());await waitFor(()=>expect(screen.getByRole("button",{name:"画像から入力"}).hasAttribute("disabled")).toBe(false));
 expect(apply).not.toHaveBeenCalled();expect(screen.queryByText("反映先の確認")).toBeNull();
});
