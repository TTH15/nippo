import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";

// 画面確認用の端末設定。ログイン情報や本番設定と分離する。
const key = "hakotora_ui_preview_haptics";
type Preferences = { enabled: boolean; pending: boolean; error: string; setEnabled: (value: boolean) => void };
const Context = createContext<Preferences | null>(null);
export function HapticPreferences({ children }: { children: ReactNode }) {
  const [enabled, setValue] = useState(false), [pending, setPending] = useState(true), [error, setError] = useState("");
  const alive = useRef(true), saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    SecureStore.getItemAsync(key).then(value => { if (alive.current) setValue(value !== "off"); })
      .catch(() => { if (alive.current) setError("設定を読み込めませんでした。もう一度選んでください。"); })
      .finally(() => { if (alive.current) setPending(false); });
    return () => { alive.current = false; };
  }, []);
  const setEnabled = (value: boolean) => {
    if (pending || saving.current) return;
    saving.current = true;
    const previous = enabled;
    setValue(value); setPending(true); setError("");
    void SecureStore.setItemAsync(key, value ? "on" : "off").catch(() => {
      if (alive.current) { setValue(previous); setError("設定を保存できませんでした。もう一度お試しください。"); }
    }).finally(() => { saving.current = false; if (alive.current) setPending(false); });
  };
  return <Context.Provider value={{ enabled, pending, error, setEnabled }}>{children}</Context.Provider>;
}
export function useHapticPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("HapticPreferences provider required");
  return value;
}
