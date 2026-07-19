// 認証まわりの型。ストレージ/遷移ハンドラの抽象は @platform/auth へ昇格(ADR-0002)。
// StoredDriver はドメイン型(ドライバー)のためこのリポジトリに残す。
export type { KeyValueStorage, UnauthorizedHandler } from "@platform/auth";

/** ログイン中ドライバーの最小プロフィール(トークンと共に保持) */
export type StoredDriver = {
  id: string;
  name: string;
  role: string;
  companyCode?: string;
  officeCode?: string;
  driverCode?: string;
  /** §2-6: この membership が持つ capability(can_*)。UI の権限出し分けに使う。 */
  capabilities?: string[];
};
