import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@repo/core/api";
import type { SubmitVehicle } from "@repo/core/types";
import { fetchToday, type WorkSession } from "./api/work";

// 稼働セッション（出退勤）の状態をアプリ全体で共有する。
// 業務ホーム（WorkScreen）だけでなく、他画面下部の「稼働中ミニバー」（Spotify 型業務中モード）
// からも参照するため、WorkScreen ローカルから Context に昇格した。
type WorkSessionValue = {
  /** 進行中のセッション（なければ null） */
  open: WorkSession | null;
  /** 今日のセッション一覧（終了済みを含む） */
  todaySessions: WorkSession[];
  /** fetchToday の読み込み中フラグ（初回＋reload 中） */
  loading: boolean;
  /** fetchToday の失敗メッセージ（ホームの警告欄に表示する） */
  loadError: string | null;
  /** 車両一覧（稼働中のプレート表示・QR退避ルートの候補に使う） */
  vehicles: SubmitVehicle[];
  reload: () => Promise<void>;
};

const WorkSessionCtx = createContext<WorkSessionValue | null>(null);

export function WorkSessionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<WorkSession | null>(null);
  const [todaySessions, setTodaySessions] = useState<WorkSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<SubmitVehicle[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const t = await fetchToday();
      setOpen(t.open);
      setTodaySessions(t.today ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "通信に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    apiFetch<{ vehicles: SubmitVehicle[] }>("/api/reports/vehicles")
      .then((d) => setVehicles(d.vehicles ?? []))
      .catch(() => setVehicles([]));
  }, [reload]);

  return (
    <WorkSessionCtx.Provider value={{ open, todaySessions, loading, loadError, vehicles, reload }}>
      {children}
    </WorkSessionCtx.Provider>
  );
}

export function useWorkSession(): WorkSessionValue {
  const v = useContext(WorkSessionCtx);
  if (!v) throw new Error("useWorkSession must be used within <WorkSessionProvider>");
  return v;
}
