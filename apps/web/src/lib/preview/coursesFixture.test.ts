import { expect, it } from "vitest";
import { createFixtureStore } from "./fixtureStore";
import { coursesFixture } from "../../../../../scripts/previews/fixtures/courses";

it("隔離プレビューでコース作成と単価保存をメモリ内で完結する", async () => {
  const store = createFixtureStore(coursesFixture, { scenario: "normal", role: "admin" });
  const created = await store.fetch("/api/admin/courses", {
    method: "POST", body: JSON.stringify({ name: "試作コース", carrier_id: "preview-carrier" }),
  }) as { course: { id: string } };
  await store.fetch("/api/admin/course-billing", {
    method: "PUT", body: JSON.stringify({ course_id: created.course.id, unitRates: [{ unit_id: "unit-parcel", revenue_per_unit: 180, payout_per_unit: 100 }] }),
  });
  const billing = await store.fetch(`/api/admin/course-billing?course_id=${created.course.id}`) as { unitRates: { revenue_per_unit: number }[] };
  expect(billing.unitRates[0].revenue_per_unit).toBe(180);
});
