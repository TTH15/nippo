import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_IMPLIES,
  expandCapabilities,
  type Capability,
} from "./capabilities";
import {
  COURSE_BILLING_VIEW_CAPS,
  COURSE_BILLING_MANAGE_CAPS,
  UNITS_MANAGE_CAPS,
  SHIFT_SLOTS_VIEW_CAPS,
  SALES_LOG_TYPES_VIEW_CAPS,
  SALES_LOG_TYPES_MANAGE_CAPS,
  COURSE_DRIVERS_CAPS,
} from "./domainCaps";

// ============================================================
// 権限ポリシーの回帰テスト（2026-08-14 権限監査）。
// 「ロールUIが約束する領域」と「ルートが要求する capability」のズレを CI で固定する。
// 実地事故: コース編集権限のみのロールが単価表 API（旧: 請求系のみ要求）で 403 になり
// コース追加がサーバーエラーに見えた。
// ============================================================

/** requireAnyPermission と同じ判定（付与束を含意展開して、要求のどれかを満たすか）。 */
function satisfies(granted: Capability[], required: Capability[]): boolean {
  const effective = expandCapabilities(granted);
  return required.some((c) => effective.has(c));
}

describe("含意（CAPABILITY_IMPLIES / expandCapabilities）", () => {
  it("含意マップはカタログ内の capability だけを参照する", () => {
    const valid = new Set<string>(CAPABILITIES);
    for (const [from, tos] of Object.entries(CAPABILITY_IMPLIES)) {
      expect(valid.has(from), `${from} はカタログ外`).toBe(true);
      for (const to of tos ?? []) {
        expect(valid.has(to), `${from} → ${to} はカタログ外`).toBe(true);
      }
    }
  });

  it("設定（全領域）の編集は、領域別4つ＋設定の閲覧をすべて含む", () => {
    const effective = expandCapabilities(["can_manage_org_settings"]);
    for (const c of [
      "can_view_org_settings",
      "can_manage_courses",
      "can_manage_carriers",
      "can_manage_report_kinds",
      "can_manage_submit_screen",
    ] as Capability[]) {
      expect(effective.has(c), `${c} が含まれていない`).toBe(true);
    }
  });

  it("領域別の編集は設定の閲覧だけを連れてくる（全領域の編集には昇格しない）", () => {
    for (const area of [
      "can_manage_courses",
      "can_manage_carriers",
      "can_manage_report_kinds",
      "can_manage_submit_screen",
    ] as Capability[]) {
      const effective = expandCapabilities([area]);
      expect(effective.has("can_view_org_settings")).toBe(true);
      expect(effective.has("can_manage_org_settings"), `${area} が全領域へ昇格している`).toBe(false);
    }
  });
});

describe("domainCaps（ロールUIの領域 ↔ ルート要求の対応）", () => {
  it("domainCaps はカタログ内の capability だけを参照する", () => {
    const valid = new Set<string>(CAPABILITIES);
    for (const caps of [
      COURSE_BILLING_VIEW_CAPS,
      COURSE_BILLING_MANAGE_CAPS,
      UNITS_MANAGE_CAPS,
      SHIFT_SLOTS_VIEW_CAPS,
      SALES_LOG_TYPES_VIEW_CAPS,
      SALES_LOG_TYPES_MANAGE_CAPS,
      COURSE_DRIVERS_CAPS,
    ]) {
      for (const c of caps) expect(valid.has(c), `${c} はカタログ外`).toBe(true);
    }
  });

  it("コース編集のみのロールが、コース追加フロー全体を完遂できる（2026-08-14 の回帰）", () => {
    const granted: Capability[] = ["can_manage_courses"];
    // コース本体（POST /api/admin/courses は can_manage_courses 単体要求）
    expect(expandCapabilities(granted).has("can_manage_courses")).toBe(true);
    // 単価表の読み書き（作成モーダルの CourseRateEditor と作成直後の保存）
    expect(satisfies(granted, COURSE_BILLING_VIEW_CAPS)).toBe(true);
    expect(satisfies(granted, COURSE_BILLING_MANAGE_CAPS)).toBe(true);
    // 便セレクタ（コース編集モーダル内）
    expect(satisfies(granted, SHIFT_SLOTS_VIEW_CAPS)).toBe(true);
    // 担当ドライバー割当
    expect(satisfies(granted, COURSE_DRIVERS_CAPS)).toBe(true);
  });

  it("キャリア／フォーム設計のみのロールが、型（units）を追加・変更できる", () => {
    expect(satisfies(["can_manage_carriers"], UNITS_MANAGE_CAPS)).toBe(true);
  });

  it("請求編集のみのロールが、売上ログの種別を閲覧・追加できる", () => {
    expect(satisfies(["can_view_billing"], SALES_LOG_TYPES_VIEW_CAPS)).toBe(true);
    expect(satisfies(["can_manage_billing"], SALES_LOG_TYPES_MANAGE_CAPS)).toBe(true);
  });

  it("設定（全領域）の編集ロールも、含意経由で各領域のルート要求を満たす（後方互換）", () => {
    const granted: Capability[] = ["can_manage_org_settings"];
    expect(satisfies(granted, COURSE_BILLING_MANAGE_CAPS)).toBe(true);
    expect(satisfies(granted, UNITS_MANAGE_CAPS)).toBe(true);
    expect(satisfies(granted, SALES_LOG_TYPES_MANAGE_CAPS)).toBe(true);
    expect(satisfies(granted, SHIFT_SLOTS_VIEW_CAPS)).toBe(true);
  });

  it("無関係なロールは要求を満たさない（緩めすぎの検知）", () => {
    // 名簿閲覧だけのロールが単価表を書けてはいけない
    expect(satisfies(["can_view_members"], COURSE_BILLING_MANAGE_CAPS)).toBe(false);
    // シフト管理だけのロールが型を書けてはいけない
    expect(satisfies(["can_manage_shifts"], UNITS_MANAGE_CAPS)).toBe(false);
    // 報酬閲覧だけのロールが売上ログ種別を書けてはいけない
    expect(satisfies(["can_view_rewards"], SALES_LOG_TYPES_MANAGE_CAPS)).toBe(false);
  });
});
