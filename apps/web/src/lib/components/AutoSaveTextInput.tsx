"use client";

import { useEffect, useState } from "react";
import { useAutoSave } from "@/lib/useAutoSave";

// ============================================================
// 入力するだけで保存されるテキスト入力（2026-08-06）。
//
// onBlur だけで保存する入力は、**blur が起きない閉じ方**（パネルを閉じる・行が消える・
// タブを閉じる）で入力が消える。React はアンマウント時に blur を発火しないため、
// 「入力したのに保存されていない」の典型的な原因になる。
// ここでは useAutoSave に載せ、離脱時は flush（即実行）して取りこぼさない。
// ============================================================

export function AutoSaveTextInput({
  value,
  onSave,
  disabled = false,
  delay = 800,
  className,
  placeholder,
  resetKey,
}: {
  /** サーバー上の現在値。外部で変わったら入力にも反映する */
  value: string;
  /** 変更を保存する。トリムした文字列（空なら null）が渡る */
  onSave: (next: string | null) => void | Promise<void>;
  disabled?: boolean;
  delay?: number;
  className?: string;
  placeholder?: string;
  /** 編集対象が切り替わったことを示すキー（別の行に付け替わったときの誤保存を防ぐ） */
  resetKey?: string | number | null;
}) {
  const [text, setText] = useState(value);

  // 外部（再取得・他ユーザーの編集）で値が変わったら追従する。
  // 入力中の上書きを避けるため、サーバー値が変わったときだけ反映する。
  useEffect(() => {
    setText(value);
  }, [value, resetKey]);

  const { flush } = useAutoSave({
    value: text,
    enabled: !disabled,
    delay,
    resetKey,
    onSave: async (next) => {
      const trimmed = next.trim();
      if (trimmed === value.trim()) return; // 実質変更なしなら送らない
      await onSave(trimmed || null);
    },
  });

  return (
    <input
      type="text"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      onChange={(e) => setText(e.target.value)}
      onBlur={flush} // 離れたら待たずに確定
    />
  );
}
