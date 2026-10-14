// @vitest-environment node
import { expect, it, vi } from "vitest";
import { saveReviewedBank } from "../../../../scripts/db/bank-cleanup-local-apply";
import { bankCleanupRow, bankStorageFields, type BankCleanupDriver } from "./bankCleanup";
const driver: BankCleanupDriver & { org_id: string } = {id:"a",org_id:"org-a",name:"見本",driver_code:"TST1",bank_name:"PayPay うぐいす支店",bank_branch_name:null,bank_account_type:null,bank_account_type_other:null,bank_no:"普通 01234567",bank_holder:"ミホン"};
const candidate={...bankCleanupRow(driver)!.candidate!,bank_name:"PayPay銀行"};
function setup(data: unknown=candidate,error: unknown=null){const q={update:vi.fn(),eq:vi.fn(),is:vi.fn(),select:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data,error})};for(const key of ["update","eq","is","select"] as const)q[key].mockReturnValue(q);return {q,db:{from:vi.fn().mockReturnValue(q)}};}
it("銀行名の手入力と原文全項目CAS、先頭0を保持",async()=>{const {q,db}=setup();expect(await saveReviewedBank(db as never,"org-a",driver,candidate,[...bankStorageFields])).toEqual({id:"a",ok:true});expect(q.update).toHaveBeenCalledWith(candidate);expect(q.eq).toHaveBeenCalledWith("org_id","org-a");expect(q.eq).toHaveBeenCalledWith("works_as_driver",true);for(const key of bankStorageFields)if(driver[key]==null)expect(q.is).toHaveBeenCalledWith(key,null);else expect(q.eq).toHaveBeenCalledWith(key,driver[key]);expect(candidate.bank_no).toBe("01234567");});
it("他社はDB更新しない",async()=>{const {db}=setup();await expect(saveReviewedBank(db as never,"org-b",driver,candidate,[...bankStorageFields])).rejects.toThrow("対象会社");expect(db.from).not.toHaveBeenCalled();});
it("競合と保存失敗を成功扱いにしない",async()=>{for(const pair of [[null,null],[null,{message:"failed"}]] as const){const {db}=setup(...pair);expect((await saveReviewedBank(db as never,"org-a",driver,candidate,[...bankStorageFields])).ok).toBe(false);}});
it("保存後の値も検査する",async()=>{const {db}=setup({...candidate,bank_no:"9999999"});expect((await saveReviewedBank(db as never,"org-a",driver,candidate,[...bankStorageFields])).error).toContain("一致しません");});
