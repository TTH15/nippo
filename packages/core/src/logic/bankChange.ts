/** 口座変更だけに使う遷移先。任意のreturnToは受け付けない。 */
export const BANK_CHANGE_PATH = "/account/bank-change";
export const bankChangeReturnPath = (value: string | null | undefined) => value === BANK_CHANGE_PATH ? BANK_CHANGE_PATH : null;
export const BANK_CHANGE_LOGIN_PATH = `/login?next=driver&returnTo=${encodeURIComponent(BANK_CHANGE_PATH)}`;
