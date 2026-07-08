// ドライバー本人に関する型。UI/DOM 非依存。

/** マイページのプロフィール表示 */
export type Profile = {
  name: string;
  officeCode: string;
  driverCode: string;
  displayName: string;
  postalCode: string;
  address: string;
  phone: string;
  /** identities.phone_verified_at の有無（SMS OTPで検証済みか。Passkeyログイン等の復旧経路に必要） */
  phoneVerified: boolean;
  /** この identity に登録済みの Passkey が1件以上あるか */
  hasPasskey: boolean;
  bankName: string;
  bankNo: string;
  bankHolder: string;
};

/** 勤務区分（同一ドライバーが複数 slot を持つ場合の識別子）。日報送信で使用 */
export type DriverIdentity = {
  id: string;
  slot: number;
  driverCode: string;
  officeCode: string;
  label?: string;
};

/** 希望休のスロット（コース枠）選択肢 */
export type DriverSlot = { id: string; name: string };
