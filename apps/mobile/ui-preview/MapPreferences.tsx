import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { mapAppPreference, parkingMapUrl, type MapApp, type MapDestination } from "../src/maps";

const key = "hakotora_ui_preview_map_app";
type Preferences = { app: MapApp; pending: boolean; error: string; setApp: (app: MapApp) => void; openMap: (place: MapDestination) => Promise<void> };
const Context = createContext<Preferences | null>(null);
export function MapPreferences({ children }: { children: ReactNode }) {
  const [app, setValue] = useState<MapApp>(mapAppPreference(null, Platform.OS));
  const [pending, setPending] = useState(true), [error, setError] = useState("");
  const alive = useRef(true), saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    SecureStore.getItemAsync(key).then(value => { if (alive.current) setValue(mapAppPreference(value, Platform.OS)); })
      .catch(() => { if (alive.current) setError("地図の設定を読み込めませんでした。もう一度選んでください。"); })
      .finally(() => { if (alive.current) setPending(false); });
    return () => { alive.current = false; };
  }, []);
  const setApp = (value: MapApp) => {
    if (pending || saving.current) return;
    saving.current = true; const previous = app;
    setValue(value); setPending(true); setError("");
    void SecureStore.setItemAsync(key, value).catch(() => {
      if (alive.current) { setValue(previous); setError("地図の設定を保存できませんでした。もう一度お試しください。"); }
    }).finally(() => { saving.current = false; if (alive.current) setPending(false); });
  };
  const openMap = async (place: MapDestination) => {
    if (pending) return;
    setError("");
    try { await Linking.openURL(parkingMapUrl(app, place)); }
    catch { if (alive.current) setError("地図を開けませんでした。もう一度お試しいただくか、設定で地図アプリを変更してください。"); }
  };
  return <Context.Provider value={{ app, pending, error, setApp, openMap }}>{children}</Context.Provider>;
}
export function useMapPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("MapPreferences provider required");
  return value;
}
