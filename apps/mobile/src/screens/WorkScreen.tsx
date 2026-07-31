import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { FontAwesome6 } from "@expo/vector-icons";
import {
  fetchToday,
  resolveQr,
  checkIn,
  checkOut,
  uploadMeterPhoto,
  uploadInspectionPhoto,
  plateText,
  type WorkSession,
  type ResolvedVehicle,
  type InspectionAngle,
} from "../api/work";
import { getGps } from "../location";
import { PunchButton } from "../components/PunchButton";
import { BottomSheet } from "../components/BottomSheet";
import { MeterScanner } from "../components/MeterScanner";
import { LicenseSpotCheck } from "../components/LicenseSpotCheck";
import { VehicleInspectionCapture, type InspectionShot } from "../components/VehicleInspectionCapture";
import { QrFallback, type FallbackResolution } from "../components/QrFallback";
import { DailyReportForm, type DailyReportFormHandle } from "../components/DailyReportForm";
import { apiFetch } from "@repo/core/api";
import type { SubmitVehicle, MeShift, VehiclePlateData } from "@repo/core/types";
import { toLocalDateStr, formatMonthDayJP, reportDateDefaultJST } from "@repo/core/logic/calendar";
import { useAuth } from "../AuthContext";

// 業務ホーム（qr_flow v2.0 Phase4）。1つの円が主役の3状態画面:
//   待機（今日のシフト＋稼働開始） / 稼働中（経過時間・車両） / 終了後（稼働サマリー）。
// 日報はホームに常設せず、退勤フロー（Bottom Sheet）の最終ステップで送信する。

const INPUT = "border border-brand-200 rounded-lg px-3 py-2.5 text-base bg-white text-brand-900";

function parseMeter(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "通信に失敗しました";
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 4 && h < 11) return "おはようございます";
  if (h >= 11 && h < 18) return "こんにちは";
  return "おつかれさまです";
}

function formatNotifTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "";
  }
}

type NotifItem = { id: string; title: string; body: string; read_at: string | null; created_at: string };

const vehiclePlate = (v: VehiclePlateData | undefined): string =>
  v ? [v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ") || v.id : "";

// 安全確認（qr_flow v2.0 Phase2）。出勤時のみ・QR認証後～車両記録の前に挟む。
// 一定確率で通常のチェックボックス確認から抜き打ちの免許証撮影確認に切り替える。
const SPOT_CHECK_RATE = 0.15;

export function WorkScreen() {
  // --- 出退勤（Phase1: QR認証 → Bottom Sheet） ---
  const [workLoading, setWorkLoading] = useState(true);
  const [open, setOpen] = useState<WorkSession | null>(null);
  const [todaySessions, setTodaySessions] = useState<WorkSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [workMsg, setWorkMsg] = useState<string | null>(null);

  const [inVehicle, setInVehicle] = useState<ResolvedVehicle | null>(null);
  const [inToken, setInToken] = useState<string | null>(null);
  const [inMeter, setInMeter] = useState("");

  // 安全確認（Phase2、出勤時のみ）: QR認証直後に自動判定・表示。通過後に車両記録(メーター)へ進む。
  const [safetyMode, setSafetyMode] = useState<"checkbox" | "photo" | null>(null);
  const [safetyPassed, setSafetyPassed] = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [licenseCameraOpen, setLicenseCameraOpen] = useState(false);

  // QR退避ルート（vehicle-session-flow.md §8.5）: 「QRが読めない」→ ナンバープレートOCR/手動申請。
  const [fallbackOpenFor, setFallbackOpenFor] = useState<"in" | "out" | null>(null);
  const [inMethod, setInMethod] = useState<"qr" | "plate_ocr" | "manual">("qr");
  const [inFallbackVehicle, setInFallbackVehicle] = useState<VehiclePlateData | null>(null);
  const [inPlatePhotoPath, setInPlatePhotoPath] = useState<string | undefined>(undefined);
  const [inFallbackReason, setInFallbackReason] = useState<string | undefined>(undefined);

  const [outToken, setOutToken] = useState<string | null>(null);
  const [outMeter, setOutMeter] = useState("");
  const [outMethod, setOutMethod] = useState<"qr" | "plate_ocr" | "manual">("qr");
  const [outFallbackVehicle, setOutFallbackVehicle] = useState<VehiclePlateData | null>(null);
  const [outPlatePhotoPath, setOutPlatePhotoPath] = useState<string | undefined>(undefined);
  const [outFallbackReason, setOutFallbackReason] = useState<string | undefined>(undefined);
  // 退勤フローのステップ: 車両記録（メーター・点検）→ 日報 → 終了確定（qr_flow「終了時の確認」＋日報統合）
  const [outStep, setOutStep] = useState<"meter" | "report">("meter");
  const reportRef = useRef<DailyReportFormHandle>(null);

  const [meterScanFor, setMeterScanFor] = useState<"in" | "out" | null>(null);
  const [meterBase64, setMeterBase64] = useState<string | null>(null);

  // 車両点検（Phase3・前後左右4方向）。in/outどちらの車両記録でも撮影可能（pre/postの比較用）。
  const [inspectionOpenFor, setInspectionOpenFor] = useState<"in" | "out" | null>(null);
  const [inInspectionPaths, setInInspectionPaths] = useState<Array<{ angle: InspectionAngle; path: string }>>([]);
  const [outInspectionPaths, setOutInspectionPaths] = useState<Array<{ angle: InspectionAngle; path: string }>>([]);
  const [inspectionUploading, setInspectionUploading] = useState(false);

  // --- ホーム表示用データ ---
  const { driver } = useAuth();
  const navigation = useNavigation<{ navigate: (name: string) => void; addListener: (ev: "focus", cb: () => void) => () => void }>();
  const today = reportDateDefaultJST();
  const [vehicles, setVehicles] = useState<SubmitVehicle[]>([]);
  const [todayShifts, setTodayShifts] = useState<MeShift[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  // 稼働中の経過時間表示用（1分ごとに再描画）
  const [nowTick, setNowTick] = useState(() => Date.now());

  // 通知（ベルのドット＋ホームのお知らせ欄）。ホームに戻るたびに更新する。
  useEffect(() => {
    const fetchNotifs = () =>
      apiFetch<{ notifications: NotifItem[]; unreadCount: number }>("/api/me/notifications")
        .then((d) => {
          setUnreadCount(d.unreadCount ?? 0);
          setNotifs((d.notifications ?? []).slice(0, 3));
        })
        .catch(() => {});
    fetchNotifs();
    return navigation.addListener("focus", fetchNotifs);
  }, [navigation]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    // 車両一覧: QR退避ルートの候補＋稼働中のプレート表示に使う
    apiFetch<{ vehicles: SubmitVehicle[] }>("/api/reports/vehicles")
      .then((d) => setVehicles(d.vehicles ?? []))
      .catch(() => setVehicles([]));
    // 今日のシフト（待機状態のカード表示用）
    apiFetch<{ shifts: MeShift[] }>(`/api/me/shifts?start=${today}&end=${today}`)
      .then((d) => setTodayShifts(d.shifts ?? []))
      .catch(() => setTodayShifts([]));
  }, [today]);

  function onMeterConfirmed(value: number | null, base64: string) {
    if (value != null) {
      if (meterScanFor === "in") setInMeter(String(value));
      else if (meterScanFor === "out") setOutMeter(String(value));
    }
    setMeterBase64(base64);
    setMeterScanFor(null);
  }

  async function onInspectionComplete(shots: InspectionShot[]) {
    const target = inspectionOpenFor;
    setInspectionOpenFor(null);
    if (!target) return;
    setInspectionUploading(true);
    const paths: Array<{ angle: InspectionAngle; path: string }> = [];
    for (const shot of shots) {
      try {
        const { path } = await uploadInspectionPhoto(shot.base64);
        paths.push({ angle: shot.angle, path });
      } catch {
        // 写真アップロード失敗は無視（この角度だけ欠けても業務は続行できる）
      }
    }
    setInspectionUploading(false);
    if (target === "in") setInInspectionPaths(paths);
    else setOutInspectionPaths(paths);
  }

  const reload = useCallback(async () => {
    setWorkLoading(true);
    try {
      const t = await fetchToday();
      setOpen(t.open);
      setTodaySessions(t.today ?? []);
    } catch (e) {
      setWorkMsg(errMsg(e));
    } finally {
      setWorkLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onScanIn(data: string): Promise<boolean> {
    setBusy(true);
    setWorkMsg(null);
    try {
      const r = await resolveQr(data);
      if (!r.ok || !r.vehicle) {
        setWorkMsg(r.message ?? "読み取れませんでした。");
        return false;
      }
      setInVehicle(r.vehicle);
      setInToken(data);
      setInMethod("qr");
      setInFallbackVehicle(null);
      setInPlatePhotoPath(undefined);
      setInFallbackReason(undefined);
      setSafetyMode(Math.random() < SPOT_CHECK_RATE ? "photo" : "checkbox");
      setSafetyPassed(false);
      setLicenseChecked(false);
      return true;
    } catch (e) {
      setWorkMsg(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onInFallbackResolved(result: FallbackResolution) {
    setFallbackOpenFor(null);
    const v = result.vehicle;
    setInVehicle({
      id: v.id,
      numberPrefix: v.number_prefix ?? null,
      numberClass: v.number_class ?? null,
      numberHiragana: v.number_hiragana ?? null,
      numberNumeric: v.number_numeric ?? null,
    });
    setInToken(null);
    setInMethod(result.method);
    setInFallbackVehicle(v);
    setInPlatePhotoPath(result.method === "plate_ocr" ? result.platePhotoPath : undefined);
    setInFallbackReason(result.method === "manual" ? result.fallbackReason : undefined);
    setSafetyMode(Math.random() < SPOT_CHECK_RATE ? "photo" : "checkbox");
    setSafetyPassed(false);
    setLicenseChecked(false);
  }

  async function confirmIn() {
    if (!inToken && !inFallbackVehicle) return;
    setBusy(true);
    setWorkMsg(null);
    try {
      const gps = await getGps();
      let odometerPhotoPath: string | undefined;
      if (meterBase64) {
        try {
          odometerPhotoPath = (await uploadMeterPhoto(meterBase64)).path;
        } catch {
          /* 写真アップロード失敗は無視 */
        }
      }
      const res = await checkIn({
        ...(inToken
          ? { token: inToken }
          : { method: inMethod, vehicleId: inFallbackVehicle!.id, platePhotoPath: inPlatePhotoPath, fallbackReason: inFallbackReason }),
        odometer: parseMeter(inMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
        inspectionPhotos: inInspectionPaths,
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "出勤に失敗しました。");
        return;
      }
      cancelIn();
      await reload();
    } catch (e) {
      setWorkMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelIn() {
    setInVehicle(null);
    setInToken(null);
    setInMeter("");
    setMeterBase64(null);
    setSafetyMode(null);
    setSafetyPassed(false);
    setLicenseChecked(false);
    setLicenseCameraOpen(false);
    setInInspectionPaths([]);
    setInMethod("qr");
    setInFallbackVehicle(null);
    setInPlatePhotoPath(undefined);
    setInFallbackReason(undefined);
    setWorkMsg(null);
  }

  async function onScanOut(data: string): Promise<boolean> {
    if (!open) return false;
    setOutToken(data);
    setOutMethod("qr");
    setOutFallbackVehicle(null);
    setOutPlatePhotoPath(undefined);
    setOutFallbackReason(undefined);
    setOutStep("meter");
    return true;
  }

  function onOutFallbackResolved(result: FallbackResolution) {
    setFallbackOpenFor(null);
    setOutToken(null);
    setOutMethod(result.method);
    setOutFallbackVehicle(result.vehicle);
    setOutPlatePhotoPath(result.method === "plate_ocr" ? result.platePhotoPath : undefined);
    setOutFallbackReason(result.method === "manual" ? result.fallbackReason : undefined);
    setOutStep("meter");
  }

  // 業務終了の確定。日報は checkOut 成功後に送信する（qr_flow「終了時の確認」＋日報統合）。
  // 日報送信だけが失敗しても業務終了は成立させ、ホームの「日報を書く」から再送できるよう案内する。
  async function confirmOut(withReport: boolean) {
    if (!open || (!outToken && !outFallbackVehicle)) return;
    setBusy(true);
    setWorkMsg(null);
    try {
      const gps = await getGps();
      let odometerPhotoPath: string | undefined;
      if (meterBase64) {
        try {
          odometerPhotoPath = (await uploadMeterPhoto(meterBase64)).path;
        } catch {
          /* 写真アップロード失敗は無視 */
        }
      }
      const res = await checkOut({
        sessionId: open.id,
        ...(outToken
          ? { token: outToken }
          : { method: outMethod, vehicleId: outFallbackVehicle!.id, platePhotoPath: outPlatePhotoPath, fallbackReason: outFallbackReason }),
        odometer: parseMeter(outMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
        inspectionPhotos: outInspectionPaths,
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "業務終了に失敗しました。");
        return;
      }
      if (withReport) {
        const sent = await reportRef.current?.submit();
        if (!sent) {
          setWorkMsg("業務は終了しました。日報の送信に失敗したため「日報を書く」からもう一度送信してください。");
        }
      }
      cancelOut();
      await reload();
    } catch (e) {
      setWorkMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelOut() {
    setOutToken(null);
    setOutMeter("");
    setMeterBase64(null);
    setOutInspectionPaths([]);
    setOutMethod("qr");
    setOutFallbackVehicle(null);
    setOutPlatePhotoPath(undefined);
    setOutFallbackReason(undefined);
    setOutStep("meter");
  }

  // QR退避ルートの候補車両。退勤は稼働中セッションの車両1台に絞る（それ以外は結局サーバに拒否されるため）。
  const outFallbackCandidates = (() => {
    if (!open) return vehicles;
    const match = vehicles.find((v) => v.id === open.vehicle_id);
    return match ? [match] : vehicles;
  })();

  // --- ホームの状態導出 ---
  const closedToday = todaySessions.filter((s) => s.status === "closed" && s.started_at && s.ended_at);
  const homeState: "waiting" | "working" | "done" = open ? "working" : closedToday.length > 0 ? "done" : "waiting";

  const workedMs = closedToday.reduce(
    (sum, s) => sum + (new Date(s.ended_at!).getTime() - new Date(s.started_at!).getTime()),
    0,
  );
  const workedKm = closedToday.reduce((sum, s) => {
    if (s.start_odometer == null || s.end_odometer == null) return sum;
    const d = s.end_odometer - s.start_odometer;
    return d > 0 ? sum + d : sum;
  }, 0);

  const openVehicle = open ? vehicles.find((v) => v.id === open.vehicle_id) : undefined;
  const elapsedMs = open?.started_at ? nowTick - new Date(open.started_at).getTime() : 0;

  if (workLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-50">
      <ScrollView className="flex-1" contentContainerClassName="pt-16 pb-10 px-4 gap-4">
        {/* ヘッダー: 日付＋右上に通知ベル・マイページ */}
        <View className="flex-row items-center justify-between">
          <Text className="text-[24px] font-bold text-brand-900">{formatMonthDayJP(today)}</Text>
          <View className="flex-row items-center gap-2">
            <Pressable
              className="w-10 h-10 rounded-full bg-white border border-brand-100 items-center justify-center active:opacity-70"
              onPress={() => navigation.navigate("通知")}
            >
              <FontAwesome6 name="bell" size={16} color="#454c56" iconStyle="solid" />
              {unreadCount > 0 && <View className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-accent-500" />}
            </Pressable>
            <Pressable
              className="w-10 h-10 rounded-full bg-white border border-brand-100 items-center justify-center active:opacity-70"
              onPress={() => navigation.navigate("マイページ")}
            >
              <FontAwesome6 name="user" size={16} color="#454c56" iconStyle="solid" />
            </Pressable>
          </View>
        </View>

        {workMsg && (
          <View className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <Text className="text-amber-800 text-[13px]">{workMsg}</Text>
          </View>
        )}

        {/* ヒーローカード: 挨拶＋今日のシフト（将来: 3D軽バン＋箱アニメの舞台） */}
        <View className="bg-white rounded-2xl p-5 gap-1 shadow-sm">
          <Text className="text-[13px] text-brand-500">{greeting()}</Text>
          <Text className="text-xl font-bold text-brand-900 mb-2">{driver.name} さん</Text>
          <View className="gap-1.5 mb-3">
            {todayShifts.length === 0 ? (
              <Text className="text-brand-400 text-[13px]">今日のシフトはありません</Text>
            ) : (
              todayShifts.map((s, i) => (
                <View key={i} className="flex-row items-center gap-2.5">
                  <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.course_color || "#a9b0b8" }} />
                  <Text className="text-brand-900 text-[15px] font-semibold flex-1">{s.course_name}</Text>
                  {s.vehicle && <Text className="text-brand-500 text-[13px]">{vehiclePlate(s.vehicle)}</Text>}
                </View>
              ))
            )}
          </View>
          <Pressable
            className="flex-row items-center justify-between border border-brand-200 rounded-xl px-4 py-3 active:opacity-70"
            onPress={() => navigation.navigate("シフト")}
          >
            <View className="flex-row items-center gap-2.5">
              <FontAwesome6 name="calendar-days" size={14} color="#454c56" iconStyle="solid" />
              <Text className="text-brand-800 font-medium text-[14px]">シフト・予定を確認</Text>
            </View>
            <FontAwesome6 name="chevron-right" size={12} color="#a9b0b8" iconStyle="solid" />
          </Pressable>
        </View>

        {/* 状態: 待機 → 稼働開始カード */}
        {homeState === "waiting" && (
          <View className="bg-accent-400 rounded-2xl items-center px-5 pt-7 pb-8 gap-1 overflow-hidden">
            <Text className="text-white text-xl font-bold">稼働開始</Text>
            <Text className="text-white/90 text-[13px] mb-4">長押しでQRを読み取ります</Text>
            <PunchButton
              mode="start"
              busy={busy}
              iconOnly
              showCaption={false}
              onScanned={onScanIn}
              onFallback={() => setFallbackOpenFor("in")}
            />
          </View>
        )}

        {/* 状態: 稼働中 */}
        {homeState === "working" && open && (
          <View className="bg-brand-900 rounded-2xl p-5 gap-4">
            <View className="flex-row items-center gap-1.5">
              <View className="w-2 h-2 rounded-full bg-accent-400" />
              <Text className="text-accent-400 font-semibold text-[13px]">稼働中</Text>
            </View>
            <View>
              <Text className="text-brand-300 text-[13px]">経過時間</Text>
              <Text className="text-white text-[40px] font-bold leading-tight">{formatDuration(elapsedMs)}</Text>
            </View>
            <View className="flex-row gap-6">
              <View>
                <Text className="text-brand-300 text-[13px]">開始</Text>
                <Text className="text-white text-base font-semibold">{formatTime(open.started_at)}</Text>
              </View>
              {openVehicle && (
                <View>
                  <Text className="text-brand-300 text-[13px]">車両</Text>
                  <Text className="text-white text-base font-semibold">{vehiclePlate(openVehicle)}</Text>
                </View>
              )}
              {open.start_odometer != null && (
                <View>
                  <Text className="text-brand-300 text-[13px]">開始メーター</Text>
                  <Text className="text-white text-base font-semibold">{open.start_odometer} km</Text>
                </View>
              )}
            </View>
            <View className="items-center pt-2">
              <PunchButton
                mode="end"
                busy={busy}
                onScanned={onScanOut}
                onFallback={() => setFallbackOpenFor("out")}
              />
            </View>
          </View>
        )}

        {/* 状態: 終了後 → サマリー＋再開の円 */}
        {homeState === "done" && (
          <>
            <View className="bg-white rounded-2xl p-5 gap-3 shadow-sm">
              <Text className="text-[13px] text-brand-500 font-semibold">本日の稼働</Text>
              <View className="flex-row gap-8">
                <View>
                  <Text className="text-brand-500 text-[13px]">稼働時間</Text>
                  <Text className="text-brand-900 text-[28px] font-bold">{formatDuration(workedMs)}</Text>
                </View>
                {workedKm > 0 && (
                  <View>
                    <Text className="text-brand-500 text-[13px]">走行距離</Text>
                    <Text className="text-brand-900 text-[28px] font-bold">
                      {workedKm}
                      <Text className="text-base font-semibold"> km</Text>
                    </Text>
                  </View>
                )}
              </View>
              <Text className="text-brand-500">お疲れさまでした。</Text>
              <Pressable
                className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
                onPress={() => setReportSheetOpen(true)}
              >
                <Text className="text-brand-700 font-medium">日報を書く・修正する</Text>
              </Pressable>
            </View>
            <View className="bg-accent-400 rounded-2xl items-center px-5 pt-6 pb-7 gap-1 overflow-hidden">
              <Text className="text-white/90 text-[13px] mb-3">もう一度稼働する場合は長押し</Text>
              <PunchButton
                mode="start"
                busy={busy}
                iconOnly
                showCaption={false}
                onScanned={onScanIn}
                onFallback={() => setFallbackOpenFor("in")}
              />
            </View>
          </>
        )}

        {/* お知らせ */}
        <View className="gap-2">
          <View className="flex-row items-center justify-between px-1">
            <Text className="text-base font-bold text-brand-900">お知らせ</Text>
            <Pressable className="flex-row items-center gap-1 active:opacity-70" onPress={() => navigation.navigate("通知")}>
              <Text className="text-[13px] text-brand-500">すべて見る</Text>
              <FontAwesome6 name="chevron-right" size={10} color="#a9b0b8" iconStyle="solid" />
            </Pressable>
          </View>
          {notifs.length === 0 ? (
            <View className="bg-white rounded-xl p-4">
              <Text className="text-brand-400 text-[13px]">お知らせはまだありません</Text>
            </View>
          ) : (
            notifs.map((n) => (
              <Pressable
                key={n.id}
                className="bg-white rounded-xl p-3.5 flex-row items-center gap-3 active:opacity-70"
                onPress={() => navigation.navigate("通知")}
              >
                <View className={`w-9 h-9 rounded-full items-center justify-center ${n.read_at ? "bg-brand-50" : "bg-accent-50"}`}>
                  <FontAwesome6 name="bell" size={13} color={n.read_at ? "#7c848f" : "#d97706"} iconStyle="solid" />
                </View>
                <View className="flex-1">
                  <Text className={`text-[14px] ${n.read_at ? "text-brand-700" : "font-bold text-brand-900"}`} numberOfLines={1}>
                    {n.title}
                  </Text>
                  <Text className="text-[12px] text-brand-500" numberOfLines={1}>
                    {n.body}
                  </Text>
                </View>
                <Text className="text-[11px] text-brand-400">{formatNotifTime(n.created_at)}</Text>
              </Pressable>
            ))
          )}
        </View>

        {/* クイックアクセス */}
        <View className="flex-row gap-3">
          {(
            [
              { label: "シフト", icon: "calendar-days" as const, to: "シフト" },
              { label: "報酬", icon: "gift" as const, to: "報酬" },
            ]
          ).map((q) => (
            <Pressable
              key={q.to}
              className="flex-1 bg-white rounded-xl items-center py-4 gap-2 active:opacity-70"
              onPress={() => navigation.navigate(q.to)}
            >
              <FontAwesome6 name={q.icon} size={18} color="#454c56" iconStyle="solid" />
              <Text className="text-[13px] text-brand-700 font-medium">{q.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* 出勤: QR認証後の安全確認（Phase2） */}
      <BottomSheet visible={inVehicle !== null && !safetyPassed}>
        <Text className="text-[13px] text-brand-500">安全確認</Text>
        {safetyMode === "photo" ? (
          <>
            <Text className="text-xl font-bold text-brand-900">免許証を撮影して確認します</Text>
            <Pressable
              className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
              onPress={() => setLicenseCameraOpen(true)}
            >
              <Text className="text-brand-700 font-medium">免許証を撮影する</Text>
            </Pressable>
          </>
        ) : (
          <Pressable className="flex-row items-center gap-2.5 py-1" onPress={() => setLicenseChecked((v) => !v)}>
            <View
              className={`w-6 h-6 rounded-md border items-center justify-center ${licenseChecked ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
            >
              {licenseChecked ? <Text className="text-white font-bold">✓</Text> : null}
            </View>
            <Text className="text-base text-brand-900">免許証を携帯しています</Text>
          </Pressable>
        )}
        <View className="flex-row gap-2 mt-1">
          {safetyMode === "checkbox" && (
            <Pressable
              className={`flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80 ${!licenseChecked ? "opacity-40" : ""}`}
              onPress={() => setSafetyPassed(true)}
              disabled={!licenseChecked}
            >
              <Text className="text-white font-semibold">次へ</Text>
            </Pressable>
          )}
          <Pressable className="px-4 bg-brand-100 rounded-lg py-3 items-center active:opacity-80" onPress={cancelIn}>
            <Text className="text-brand-600">やめる</Text>
          </Pressable>
        </View>
      </BottomSheet>

      {/* 出勤: 安全確認後の車両確認・メーター入力 */}
      <BottomSheet visible={inVehicle !== null && safetyPassed}>
        <Text className="text-[13px] text-brand-500">この車両で出勤します</Text>
        <Text className="text-xl font-bold text-brand-900">{plateText(inVehicle) || "車両"}</Text>
        <Text className="text-[13px] text-brand-500 mt-1">開始メーター（km）</Text>
        <TextInput
          className={INPUT}
          value={inMeter}
          onChangeText={(t) => setInMeter(t.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          placeholder="例: 123456"
        />
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setMeterScanFor("in")}
          disabled={busy}
        >
          <Text className="text-brand-700 font-medium">メーターをカメラで読み取り</Text>
        </Pressable>
        {meterBase64 ? <Text className="text-xs text-accent-600">写真を添付しました</Text> : null}
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setInspectionOpenFor("in")}
          disabled={busy || inspectionUploading}
        >
          <Text className="text-brand-700 font-medium">車両点検（前後左右を撮影）</Text>
        </Pressable>
        {inspectionUploading ? (
          <Text className="text-xs text-brand-400">点検写真をアップロード中...</Text>
        ) : inInspectionPaths.length > 0 ? (
          <Text className="text-xs text-accent-600">点検写真を{inInspectionPaths.length}枚添付しました</Text>
        ) : null}
        <View className="flex-row gap-2 mt-1">
          <Pressable
            className="flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80"
            onPress={confirmIn}
            disabled={busy}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white font-semibold">出勤する</Text>}
          </Pressable>
          <Pressable
            className="px-4 bg-brand-100 rounded-lg py-3 items-center active:opacity-80"
            onPress={cancelIn}
            disabled={busy}
          >
            <Text className="text-brand-600">やめる</Text>
          </Pressable>
        </View>
      </BottomSheet>

      {/* 退勤: QR認証後の終了フロー（①車両記録 → ②日報 → 終了確定） */}
      <BottomSheet visible={(outToken !== null || outFallbackVehicle !== null) && outStep === "meter"}>
        <Text className="text-[13px] text-brand-500">業務終了 1/2 — 車両記録</Text>
        <Text className="text-[13px] text-brand-500 mt-1">終了メーター（km）</Text>
        <TextInput
          className={INPUT}
          value={outMeter}
          onChangeText={(t) => setOutMeter(t.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          placeholder="例: 123480"
        />
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setMeterScanFor("out")}
          disabled={busy}
        >
          <Text className="text-brand-700 font-medium">メーターをカメラで読み取り</Text>
        </Pressable>
        {meterBase64 ? <Text className="text-xs text-accent-600">写真を添付しました</Text> : null}
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setInspectionOpenFor("out")}
          disabled={busy || inspectionUploading}
        >
          <Text className="text-brand-700 font-medium">車両点検（前後左右を撮影）</Text>
        </Pressable>
        {inspectionUploading ? (
          <Text className="text-xs text-brand-400">点検写真をアップロード中...</Text>
        ) : outInspectionPaths.length > 0 ? (
          <Text className="text-xs text-accent-600">点検写真を{outInspectionPaths.length}枚添付しました</Text>
        ) : null}
        <View className="flex-row gap-2 mt-1">
          <Pressable
            className="flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80"
            onPress={() => setOutStep("report")}
            disabled={busy}
          >
            <Text className="text-white font-semibold">次へ（日報）</Text>
          </Pressable>
          <Pressable
            className="px-4 bg-brand-100 rounded-lg py-3 items-center active:opacity-80"
            onPress={cancelOut}
            disabled={busy}
          >
            <Text className="text-brand-600">やめる</Text>
          </Pressable>
        </View>
      </BottomSheet>

      {/* 退勤: ②日報を書いて業務終了（qr_flow 終了時の確認＋日報統合） */}
      <BottomSheet visible={(outToken !== null || outFallbackVehicle !== null) && outStep === "report"} scrollable>
        <Text className="text-[13px] text-brand-500">業務終了 2/2 — 日報</Text>
        <DailyReportForm ref={reportRef} date={today} />
        <View className="flex-row gap-2 mt-1">
          <Pressable
            className="flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80"
            onPress={() => confirmOut(true)}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-white font-semibold">日報を送信して業務終了</Text>
            )}
          </Pressable>
        </View>
        <View className="flex-row gap-2">
          <Pressable
            className="flex-1 border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
            onPress={() => confirmOut(false)}
            disabled={busy}
          >
            <Text className="text-brand-600">日報はあとで書いて業務終了</Text>
          </Pressable>
          <Pressable
            className="px-4 bg-brand-100 rounded-lg py-2.5 items-center active:opacity-80"
            onPress={() => setOutStep("meter")}
            disabled={busy}
          >
            <Text className="text-brand-600">戻る</Text>
          </Pressable>
        </View>
      </BottomSheet>

      {/* ホーム（終了後）からの日報シート */}
      <BottomSheet visible={reportSheetOpen} scrollable>
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-brand-900">日報</Text>
          <Pressable className="px-3 py-1.5 rounded-lg bg-brand-100 active:opacity-80" onPress={() => setReportSheetOpen(false)}>
            <Text className="text-brand-600">閉じる</Text>
          </Pressable>
        </View>
        <DailyReportForm date={today} showSubmitButton onSubmitted={() => setReportSheetOpen(false)} />
      </BottomSheet>

      <MeterScanner visible={meterScanFor !== null} onConfirm={onMeterConfirmed} onClose={() => setMeterScanFor(null)} />

      <VehicleInspectionCapture
        visible={inspectionOpenFor !== null}
        onComplete={onInspectionComplete}
        onClose={() => setInspectionOpenFor(null)}
      />

      <QrFallback
        visible={fallbackOpenFor !== null}
        vehicles={fallbackOpenFor === "out" ? outFallbackCandidates : vehicles}
        onResolved={fallbackOpenFor === "out" ? onOutFallbackResolved : onInFallbackResolved}
        onClose={() => setFallbackOpenFor(null)}
      />

      <LicenseSpotCheck
        visible={licenseCameraOpen}
        onConfirm={() => {
          setLicenseCameraOpen(false);
          setSafetyPassed(true);
        }}
        onClose={() => setLicenseCameraOpen(false)}
      />
    </View>
  );
}
