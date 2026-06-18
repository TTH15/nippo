// プロフィール表示・PIN変更の純粋ロジック（プラットフォーム非依存）。
import type { Profile } from "@/core/types";

/** 数字以外を取り除く（PIN等の数値入力サニタイズ）。 */
export function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

/** PIN変更の入力検証（6桁数字・確認一致）。 */
export function validatePinChange(
  newPin: string,
  confirmPin: string,
): { ok: boolean; message?: string } {
  if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
    return { ok: false, message: "新しいPINは6桁の数字で入力してください" };
  }
  if (newPin !== confirmPin) {
    return { ok: false, message: "新しいPINと確認用が一致しません" };
  }
  return { ok: true };
}

/** プロフィール表示用の label/value 一覧（空値は除外、表示順を固定）。 */
export function buildProfileEntries(
  profile: Profile | null,
): { label: string; value: string }[] {
  if (!profile) return [];
  return [
    { label: "名前", value: profile.name },
    { label: "表示名", value: profile.displayName },
    { label: "ドライバーコード", value: profile.driverCode },
    { label: "営業所コード", value: profile.officeCode },
    { label: "郵便番号", value: profile.postalCode },
    { label: "住所", value: profile.address },
    { label: "電話番号", value: profile.phone },
    { label: "銀行名", value: profile.bankName },
    { label: "口座番号", value: profile.bankNo },
    { label: "口座名義", value: profile.bankHolder },
  ].filter((e) => e.value !== undefined && e.value !== "");
}
