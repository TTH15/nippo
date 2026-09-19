// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plateModelPath, signPlateModels } from "./plateModelStorage";
const v = { id: "vehicle", manufacturer: "スズキ", brand: "エブリイ", model_key: "every", model_code: "DA17V", number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "1234" };
describe("プレートの版と車体の一致", () => {
  it("型式・外観・番号・会社が変わると別ファイルを使い、色だけなら再利用する", () => {
    const base = plateModelPath("org-a", v);
    for (const variant of [{ ...v, model_code: "DA64V" }, { ...v, model_key: "appearance:every-photo-custom" }, { ...v, number_numeric: "1235" }]) expect(plateModelPath("org-a", variant)).not.toBe(base);
    expect(plateModelPath("org-b", v)).not.toBe(base);
    expect(base).not.toContain("大阪");
    expect(base).toContain("/kei-every-da17v-");
  });
  it("未生成の新しい版に旧パスのプレートを代用しない", async () => {
    const sign = vi.fn(async () => ({ data: [{ signedUrl: null, error: "not found" }], error: null }));
    const client = { storage: { from: () => ({ createSignedUrls: sign }) } } as unknown as SupabaseClient;
    expect(await signPlateModels(client, "org-a", [v])).toEqual({});
    expect(sign).toHaveBeenCalledWith([plateModelPath("org-a", v)], 3600);
  });
});
