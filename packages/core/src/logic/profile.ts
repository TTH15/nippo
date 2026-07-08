// プロフィール表示・PIN変更の純粋ロジック（プラットフォーム非依存）。
import type { Profile } from "../types";

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

/**
 * E.164(+81...)形式の電話番号を日本国内の表示形式に変換する（先頭0・携帯はハイフン区切り）。
 * 変換できない形式はそのまま返す。
 */
export function formatJPPhoneDisplay(phone: string): string {
  if (!phone) return phone;
  let digits = phone;
  if (digits.startsWith("+81")) {
    digits = "0" + digits.slice(3);
  }
  digits = digits.replace(/[^\d]/g, "");
  if (!digits.startsWith("0")) return phone;
  // 携帯(070/080/090) 11桁は 3-4-4 でハイフン区切り。それ以外は桁数不定なので数字のみ返す。
  if (digits.length === 11 && /^0[789]0/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return digits;
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
