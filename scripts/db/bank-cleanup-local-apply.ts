import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankStorage } from "../../apps/web/src/lib/bankAccount";
import type { BankCleanupDriver } from "../../apps/web/src/lib/bankCleanup";
export async function saveReviewedBank(db: SupabaseClient, orgId: string, driver: BankCleanupDriver & { org_id: string }, candidate: BankStorage, columns: (keyof BankStorage)[]) {
 if(driver.org_id !== orgId) throw Error("対象会社が違います");
 let query=db.from("drivers").update(Object.fromEntries(columns.map(key=>[key,candidate[key]??null]))).eq("org_id",orgId).eq("id",driver.id).eq("works_as_driver",true);
 for(const key of columns)query=driver[key]==null?query.is(key,null):query.eq(key,driver[key]!);
 const result=await query.select(columns.join(",")).maybeSingle();
 if(result.error)return {id:driver.id,ok:false,error:"保存できませんでした。再試行してください"};
 if(!result.data)return {id:driver.id,ok:false,error:"保存内容が変わっています。更新せずに止めました"};
 const saved = result.data as unknown as BankStorage;
 if(columns.some(key => saved[key] !== (candidate[key]??null)))return {id:driver.id,ok:false,error:"保存後の内容が一致しません。再実行せず管理者へ連絡してください"};
 return {id:driver.id,ok:true};
}
