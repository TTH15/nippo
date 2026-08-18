"use client";

// 取引先（invoice_addresses）の入力欄。法人アドレス帳と取引先ページの
// 追加・編集で共用する。同じ5項目が別々に書かれていると、片方だけ項目が
// 増えて「新規では入れられるのに後から直せない」状態になる（実際そうなっていた）。

export type CounterpartyAddressForm = {
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  invoiceNo: string;
};

export const EMPTY_COUNTERPARTY_ADDRESS_FORM: CounterpartyAddressForm = {
  name: "",
  postalCode: "",
  address: "",
  phone: "",
  invoiceNo: "",
};

/** API の行（スネークケース）→ 入力フォーム。 */
export function counterpartyAddressFormFrom(row: {
  name?: string | null;
  postal_code?: string | null;
  address?: string | null;
  phone?: string | null;
  invoice_no?: string | null;
}): CounterpartyAddressForm {
  return {
    name: row.name ?? "",
    postalCode: row.postal_code ?? "",
    address: row.address ?? "",
    phone: row.phone ?? "",
    invoiceNo: row.invoice_no ?? "",
  };
}

/** 入力フォーム → POST / PUT のボディ（空欄は null）。 */
export function counterpartyAddressBody(form: CounterpartyAddressForm) {
  return {
    name: form.name.trim(),
    postalCode: form.postalCode.trim() || null,
    address: form.address.trim() || null,
    phone: form.phone.trim() || null,
    invoiceNo: form.invoiceNo.trim() || null,
  };
}

const INPUT_CLASS =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400";

export function CounterpartyAddressFields({
  value,
  onChange,
  disabled = false,
}: {
  value: CounterpartyAddressForm;
  onChange: (next: CounterpartyAddressForm) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<CounterpartyAddressForm>) => onChange({ ...value, ...patch });

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">会社名 *</label>
        <input
          type="text"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="株式会社○○"
          disabled={disabled}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">郵便番号</label>
        <input
          type="text"
          value={value.postalCode}
          onChange={(e) => set({ postalCode: e.target.value })}
          placeholder="123-4567"
          maxLength={8}
          disabled={disabled}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">住所</label>
        <input
          type="text"
          value={value.address}
          onChange={(e) => set({ address: e.target.value })}
          placeholder="東京都○○区○○1-2-3"
          disabled={disabled}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">電話番号</label>
        <input
          type="text"
          value={value.phone}
          onChange={(e) => set({ phone: e.target.value })}
          placeholder="03-1234-5678"
          disabled={disabled}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">インボイス登録番号</label>
        <input
          type="text"
          value={value.invoiceNo}
          onChange={(e) => set({ invoiceNo: e.target.value })}
          placeholder="T1234567890123"
          disabled={disabled}
          className={INPUT_CLASS}
        />
      </div>
    </>
  );
}
