import { useState } from "react";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { ImageMemoImportDialog } from "./ImageMemoImportDialog";
const lane={id:"lane",routeId:"course",name:"C1",activeWeekdays:[1,2,3,4,5,6],color:"#fbbf24",requiredCount:1,custom:false};
const read={period:{year:2026,month:10},rows:[{name:"C1",days:[{day:18,names:["佐藤"]}]},{name:"別の枠",days:[{day:18,names:["応援"]}]}],warnings:[]};
const confirm=vi.fn();
function View({initial=["lane:lane",""]}:{initial?:string[]}) {
 const [targets,setTargets]=useState(initial);
 return <ImageMemoImportDialog file={new File(["sample"],"sample.png",{type:"image/png"})} read={read} lanes={[lane]} courses={[{id:"course",name:"豊中"}]} drivers={[{id:"driver",name:"佐藤"}]} dayOverrides={{}} dayOffByDate={new Map([["2026-10-18",new Set(["driver"])]])} targets={targets} onTargetChange={(index,value)=>setTargets(current=>current.map((target,i)=>i===index?value:target))} onClose={()=>{}} onConfirm={confirm}/>;
}
beforeEach(()=>{URL.createObjectURL=vi.fn(()=>"blob:sample");URL.revokeObjectURL=vi.fn();confirm.mockClear();Element.prototype.scrollIntoView=vi.fn();});
afterEach(cleanup);
it("未選択・同じセルへの重複をその場で直し、希望休の警告があっても読み込める",()=>{
 render(<View/>);
 const submit=screen.getByRole("button",{name:"メモに読み込む"});
 expect(submit).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("1件の読み込み先");
 fireEvent.click(screen.getByRole("button",{name:"読み込み先へ"}));
 expect(screen.getByRole("button",{name:"別の枠の読み込み先"})).toHaveFocus();
 fireEvent.click(screen.getByRole("button",{name:"別の枠の読み込み先"}));
 fireEvent.click(screen.getByRole("button",{name:"豊中 / C1"}));
 expect(submit).toBeDisabled(); expect(screen.getByText(/重複しています/)).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"別の枠の読み込み先"}));
 fireEvent.click(screen.getByRole("button",{name:"この行を読み込まない"}));
 expect(screen.getByText("希望休との重なり")).toBeVisible();
 expect(screen.getByRole("checkbox",{name:"配置がある日を稼働にする"})).toBeChecked();
 expect(submit).toBeEnabled(); fireEvent.click(submit); expect(confirm).toHaveBeenCalledWith(true);
});
it("全行を外した場合は理由を示し、行を選び直せる",()=>{
 render(<View initial={["skip","skip"]}/>);
 expect(screen.getByRole("status")).toHaveTextContent("読み込む行を選んでください");
 expect(screen.getByRole("button",{name:"メモに読み込む"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"C1の読み込み先"}));
 fireEvent.click(screen.getByRole("button",{name:"豊中 / C1"}));
 fireEvent.click(screen.getByRole("checkbox",{name:"配置がある日を稼働にする"}));
 fireEvent.click(screen.getByRole("button",{name:"メモに読み込む"})); expect(confirm).toHaveBeenCalledWith(false);
});
