import { describe, expect, it } from "vitest";
import { isMissingOrgColumn, withoutOrgId } from "./orgColumn";

// migration 174/175 の適用前にコードが出ても、希望休の提出とシフトの取込が落ちないこと。
describe("isMissingOrgColumn", () => {
  it("org_id 列が無いときだけ true", () => {
    expect(
      isMissingOrgColumn({ code: "42703", message: 'column "org_id" of relation "shift_requests" does not exist' }),
    ).toBe(true);
    expect(
      isMissingOrgColumn({ code: "PGRST204", message: "Could not find the 'org_id' column of 'shift_requests' in the schema cache" }),
    ).toBe(true);
  });

  it("他の失敗を退避経路に流さない", () => {
    expect(isMissingOrgColumn(null)).toBe(false);
    expect(isMissingOrgColumn({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingOrgColumn({ code: "42501", message: "permission denied" })).toBe(false);
    // 別の列が無いだけなら退避しない（org_id を落としても直らない）
    expect(
      isMissingOrgColumn({ code: "42703", message: 'column "slot_id" does not exist' }),
    ).toBe(false);
  });
});

describe("withoutOrgId", () => {
  it("org_id だけを落として他の列は残す", () => {
    expect(withoutOrgId([{ org_id: "org-1", driver_id: "d1", request_date: "2026-09-25" }])).toEqual([
      { driver_id: "d1", request_date: "2026-09-25" },
    ]);
  });

  it("元の配列を書き換えない", () => {
    const rows = [{ org_id: "org-1", driver_id: "d1" }];
    withoutOrgId(rows);
    expect(rows[0].org_id).toBe("org-1");
  });
});
