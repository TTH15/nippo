import { expect, it, vi } from "vitest";
vi.mock("./driverPayout", () => ({ computeDriverAutoPayout: async () => ({ lines: [], days: [] }) }));
vi.mock("./driverLease", () => ({ loadDriverLease: async () => null, loadCourseDailyLease: async () => new Map(), computeLeaseDeduction: () => 0 }));
import { buildDriverDraft, getMonthRange } from "./invoiceDraft";
it.each([
 { bank_name: "見本銀行", bank_branch_name: "中央支店", bank_account_type: "ordinary", bank_account_type_other: null, bank_no: "01234567", expectedName: "見本銀行 中央支店", expectedNo: "普通 01234567" },
 { bank_name: "見本銀行 中央支店", bank_branch_name: null, bank_account_type: null, bank_account_type_other: null, bank_no: "普通 01234567", expectedName: "見本銀行 中央支店", expectedNo: "普通 01234567" },
 { bank_name: "見本銀行", bank_branch_name: "中央支店", bank_account_type: "other", bank_account_type_other: "別段", bank_no: "01234567", expectedName: "見本銀行 中央支店", expectedNo: "別段 01234567" },
])("新旧・その他の口座を請求書へ読込んでも支店・種別・名義を失わない: $expectedNo", async row => {
 const driver = { id: "abcd", name: "見本", postal_code: null, address: null, phone: null, bank_holder: "ミホン ガク", ...row };
 const query = { select: vi.fn(), eq: vi.fn(), lte: vi.fn(), or: vi.fn(), like: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({data:driver,error:null}), then: (resolve: (value: unknown)=>unknown) => Promise.resolve({data:[],error:null}).then(resolve) };
 for(const key of ["select","eq","lte","or","like","order","limit"] as const)query[key].mockReturnValue(query);
 const db={from:vi.fn().mockReturnValue(query)};
 const result=await buildDriverDraft(db as never,"org-a","abcd",getMonthRange("2026-10"),"Amazon");
 expect(result?.driver).toMatchObject({bankName:row.expectedName,bankNo:row.expectedNo,bankHolder:"ミホン ガク"});
 expect(query.eq).toHaveBeenCalledWith("org_id","org-a");
 expect(query.select).toHaveBeenCalledWith(expect.stringContaining("bank_account_type_other"));
});
