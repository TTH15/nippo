import type { Capability } from "./capabilities";

// ============================================================
// 「複数の capability のどれかで許可する」ルートの要求集合カタログ。
// requireAnyPermission に渡す配列をここへ集約し、ロールUIの説明文と
// 実際のガードが食い違わないことをテストで固定する（capabilityPolicy.test.ts）。
//
// 背景（2026-08-14 実地報告）: 「コース／単価表の編集」ロールが単価表APIで 403 になる
// 事故があった。原因はロールUIの領域区分（コース＝単価表を含む 等）と、ルート側の
// 要求 capability（請求系のみ 等）のズレ。ズレはコードレビューでは見つけにくいため、
// 対応表をデータとして一箇所に置き、テストで意図を明文化する。
// ============================================================

/** コース単価表（course-billing / 旧 course-rates）。
 *  ロールUI「コース／単価表の編集」の領域＝can_manage_courses でも読み書きできること。 */
export const COURSE_BILLING_VIEW_CAPS: Capability[] = ["can_view_billing", "can_manage_courses"];
export const COURSE_BILLING_MANAGE_CAPS: Capability[] = ["can_manage_billing", "can_manage_courses"];

/** 型（units）。編集UIはキャリア／フォーム設計画面（can_manage_carriers）にある。
 *  コース側も単価表経由で型に触れるため can_manage_courses も許可する。 */
export const UNITS_MANAGE_CAPS: Capability[] = ["can_manage_carriers", "can_manage_courses"];

/** 便（shift-slots）の閲覧。シフト表のほか、コース編集の便セレクタ（設定領域）でも使う。 */
export const SHIFT_SLOTS_VIEW_CAPS: Capability[] = ["can_view_shifts", "can_view_org_settings"];

/** 売上ログの種別マスタ。編集UIは売上（請求領域）のログタブにある。
 *  既存ロール互換のため設定系 capability でも引き続き許可する。 */
export const SALES_LOG_TYPES_VIEW_CAPS: Capability[] = ["can_view_billing", "can_view_org_settings"];
export const SALES_LOG_TYPES_MANAGE_CAPS: Capability[] = ["can_manage_billing", "can_manage_org_settings"];

/** コース担当ドライバーの割当。コース管理と名簿管理のどちらからでも行える。 */
export const COURSE_DRIVERS_CAPS: Capability[] = ["can_manage_courses", "can_manage_members"];
