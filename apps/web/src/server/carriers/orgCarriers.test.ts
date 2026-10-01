import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orgCanEditCarrier, orgOwnsCarrier, orgOwnsUnit, orgOwnsUnitField } from "./orgCarriers";

function dbStub(rows: Record<string, Record<string, string>[]>) {
  const queries: { table: string; filters: Record<string, string> }[] = [];
  const client = {
    from(table: string) {
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        eq(column: string, value: string) {
          filters[column] = value;
          return query;
        },
        async limit(n: number) {
          queries.push({ table, filters: { ...filters } });
          return { data: (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)).slice(0, n), error: null };
        },
        async maybeSingle() {
          queries.push({ table, filters: { ...filters } });
          return {
            data: (rows[table] ?? []).find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null,
            error: null,
          };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

describe("shared carrier write boundary", () => {
  const rows = {
    company_carriers: [{ org_id: "org-a", carrier_id: "carrier-a" }],
    units: [{ id: "unit-a", carrier_id: "carrier-a" }, { id: "unit-b", carrier_id: "carrier-b" }],
    unit_fields: [{ id: "field-a", unit_id: "unit-a" }, { id: "field-b", unit_id: "unit-b" }],
  };

  it("有効化が空の会社に共有キャリアの編集権を与えない", async () => {
    const { client } = dbStub(rows);
    expect(await orgOwnsCarrier(client, "org-empty", "carrier-a")).toBe(false);
    expect(await orgOwnsCarrier(client, "org-a", "carrier-a")).toBe(true);
    expect(await orgCanEditCarrier(client, "org-empty", "carrier-a")).toBe(false);
    expect(await orgCanEditCarrier(client, "org-a", "carrier-a")).toBe(true);
  });

  it("複数社が使う共有キャリアの定義変更を拒否する", async () => {
    const { client } = dbStub({ ...rows, company_carriers: [
      { org_id: "org-a", carrier_id: "carrier-a" },
      { org_id: "org-b", carrier_id: "carrier-a" },
    ] });
    expect(await orgOwnsCarrier(client, "org-a", "carrier-a")).toBe(true);
    expect(await orgCanEditCarrier(client, "org-a", "carrier-a")).toBe(false);
    expect(await orgOwnsUnit(client, "org-a", "unit-a")).toBe(false);
  });

  it("他社の unit と報告フィールドを親まで辿って拒否する", async () => {
    const { client, queries } = dbStub(rows);
    expect(await orgOwnsUnit(client, "org-a", "unit-a")).toBe(true);
    expect(await orgOwnsUnit(client, "org-a", "unit-b")).toBe(false);
    expect(await orgOwnsUnitField(client, "org-a", "field-a")).toBe(true);
    expect(await orgOwnsUnitField(client, "org-a", "field-b")).toBe(false);
    expect(queries.some(query => query.table === "company_carriers" && query.filters.carrier_id === "carrier-b")).toBe(true);
  });
});
