import { VehicleIdentity } from "../components/VehiclePlate";
import { workCaptureSteps } from "../capture/steps";
import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import { AppIcon } from "../components/AppIcon";
import {
  resolveQr,
  checkIn,
  checkOut,
  uploadMeterPhoto,
  uploadInspectionPhoto,
  plateText,
  type ResolvedVehicle,
  type InspectionAngle,
} from "../api/work";
import { getGps } from "../location";
import { activeTrackingSessionId, drainQueuedVehicleLocations, startVehicleTracking, stopVehicleTracking } from "../backgroundVehicleLocation";
import { ParkingChoice, type ParkingChoiceValue } from "../components/ParkingChoice";
import { PunchButton } from "../components/PunchButton";
import { BottomSheet } from "../components/BottomSheet";
import { CaptureFlow, type CaptureResult, type CaptureStep, type InspectionShot } from "../components/CaptureFlow";
import { QrFallback, type FallbackResolution } from "../components/QrFallback";
import { DailyReportForm } from "../components/DailyReportForm";
import { ExtraPhotoFields } from "../components/ExtraPhotoFields";
import { HeroVan } from "../components/HeroVan";
import { apiFetch } from "@repo/core/api";
import type { MeShift, VehiclePlateData } from "@repo/core/types";
import { formatMonthDayJP, reportDateDefaultJST } from "@repo/core/logic/calendar";
import { useAuth } from "../AuthContext";
import { useWorkSession } from "../WorkSessionContext";
import { formatTime, formatDuration } from "../format";
import type { PhotoCaptureStage, PhotoCaptureTask } from "@repo/core/logic/photoCapturePolicy";

// 業務ホーム（qr_flow v2.0 Phase4）。1つの円が主役の3状態画面:
//   待機（今日のシフト＋稼働開始） / 稼働中（経過時間・車両） / 終了後（稼働サマリー）。
// 日報は稼働中・終了後のどちらからも送信できる。

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "通信に失敗しました";
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
  // 稼働セッション本体は Context（WorkSessionProvider）が持つ。ここは操作フローの状態のみ。
  const { open, todaySessions, loading: workLoading, loadError, vehicles, reload } = useWorkSession();
  const [busy, setBusy] = useState(false);
  const [workMsg, setWorkMsg] = useState<string | null>(null);
  const [parkingSessionId, setParkingSessionId] = useState<string | null>(null);
  const [parkingSheetOpen, setParkingSheetOpen] = useState(false);
  const [photoTasks, setPhotoTasks] = useState<PhotoCaptureTask[]>([]);
  const [photoTasksError, setPhotoTasksError] = useState(false);
  const [extraShots, setExtraShots] = useState<Record<string, { base64: string; mime: string }>>({});
  const [extraPaths, setExtraPaths] = useState<Record<string, string>>({});
  const [extraCapturing, setExtraCapturing] = useState(false);

  async function refreshPhotoTasks(): Promise<boolean> {
    try {
      const result = await apiFetch<{ tasks: PhotoCaptureTask[] }>("/api/work/photo-capture-tasks");
      setPhotoTasks(result.tasks ?? []);
      setPhotoTasksError(false);
      return true;
    } catch {
      setPhotoTasksError(true);
      return false;
    }
  }

  useEffect(() => {
    void refreshPhotoTasks();
  }, []);

  const tasksFor = (stage: PhotoCaptureStage) => photoTasks.filter(task => task.stage === stage);
  async function captureExtra(task: PhotoCaptureTask) {
    setExtraCapturing(true); setWorkMsg(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setWorkMsg("カメラを許可してから撮影してください。"); return; }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      const asset = result.canceled ? null : result.assets?.[0];
      if (!asset?.base64) return;
      setExtraShots(prev => ({ ...prev, [task.id]: { base64: asset.base64!, mime: asset.mimeType || "image/jpeg" } }));
      setExtraPaths(prev => { const next = { ...prev }; delete next[task.id]; return next; });
    } catch (error) { setWorkMsg(errMsg(error)); }
    finally { setExtraCapturing(false); }
  }

  async function uploadExtra(stage: PhotoCaptureStage): Promise<Array<{ angle: string; path: string }>> {
    if (photoTasksError) throw new Error("撮影項目を読み込めませんでした。画面を開き直してください。");
    const uploaded = { ...extraPaths };
    const result: Array<{ angle: string; path: string }> = [];
    for (const task of tasksFor(stage)) {
      const shot = extraShots[task.id];
      if (!shot && task.required) throw new Error(`「${task.label}」を撮影してください。`);
      if (!shot) continue;
      if (!uploaded[task.id]) {
        uploaded[task.id] = (await uploadInspectionPhoto(shot.base64, shot.mime)).path;
        setExtraPaths({ ...uploaded });
      }
      result.push({ angle: `extra:${task.id}`, path: uploaded[task.id] });
    }
    return result;
  }
  function clearExtra(stage: PhotoCaptureStage) {
    const ids = new Set(tasksFor(stage).map(task => task.id));
    setExtraShots(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
    setExtraPaths(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
  }

  useEffect(() => {
    void activeTrackingSessionId().then(setParkingSessionId);
  }, [open?.id]);

  async function saveParking(sessionId: string, gps: Awaited<ReturnType<typeof getGps>>, meterPhoto: string) {
    if (gps.status !== "captured" || gps.lat == null || gps.lng == null) {
      throw new Error("現在地を取得できませんでした。駐車した場所で、もう一度お試しください。");
    }
    const { path: odometerPhotoPath } = await uploadMeterPhoto(meterPhoto);
    const additionalPhotos = await uploadExtra("parking");
    await drainQueuedVehicleLocations().catch(() => {});
    await apiFetch("/api/work/parking", {
      method: "POST",
      body: JSON.stringify({ sessionId, odometerPhotoPath, additionalPhotos, coords: { lat: gps.lat, lng: gps.lng, accuracyM: gps.accuracyM, fixAt: gps.fixAt } }),
    });
    await stopVehicleTracking();
    setParkingSessionId(null);
  }

  const [parkingMeterBase64, setParkingMeterBase64] = useState<string | null>(null);

  async function completeParking(meterPhoto: string) {
    if (!parkingSessionId || busy) return;
    setBusy(true);
    setWorkMsg(null);
    try {
      await saveParking(parkingSessionId, await getGps(), meterPhoto);
      setParkingMeterBase64(null);
      setParkingSheetOpen(false);
      setExtraShots({}); setExtraPaths({});
      setWorkMsg("車の場所を記録しました。");
    } catch (e) { setWorkMsg(errMsg(e)); }
    finally { setBusy(false); }
  }

  const [inVehicle, setInVehicle] = useState<ResolvedVehicle | null>(null);
  const [inToken, setInToken] = useState<string | null>(null);

  // 安全確認（Phase2、出勤時のみ）は 2026-08-03 に CaptureFlow のステップへ移動した。
  // 抜き打ち（免許証撮影）に切り替わる確率だけをここで決め、フローの steps に反映する。

  // QR退避ルート（vehicle-session-flow.md §8.5）: 「QRが読めない」→ ナンバープレートOCR/手動申請。
  const [fallbackOpenFor, setFallbackOpenFor] = useState<"in" | "out" | null>(null);
  const [inMethod, setInMethod] = useState<"qr" | "plate_ocr" | "manual">("qr");
  const [inFallbackVehicle, setInFallbackVehicle] = useState<VehiclePlateData | null>(null);
  const [inPlatePhotoPath, setInPlatePhotoPath] = useState<string | undefined>(undefined);
  const [inFallbackReason, setInFallbackReason] = useState<string | undefined>(undefined);

  const [outToken, setOutToken] = useState<string | null>(null);
  const [outMethod, setOutMethod] = useState<"qr" | "plate_ocr" | "manual">("qr");
  const [outFallbackVehicle, setOutFallbackVehicle] = useState<VehiclePlateData | null>(null);
  const [outPlatePhotoPath, setOutPlatePhotoPath] = useState<string | undefined>(undefined);
  const [outFallbackReason, setOutFallbackReason] = useState<string | undefined>(undefined);
  const [outParkingStatus, setOutParkingStatus] = useState<ParkingChoiceValue>("parked");

  const [meterBase64, setMeterBase64] = useState<string | null>(null);

  // 統一キャプチャ（案A）: 円の長押し → QR〜点検を1画面で通す。
  const [captureFor, setCaptureFor] = useState<"in" | "out" | "parking" | null>(null);
  const [captureSteps, setCaptureSteps] = useState<CaptureStep[]>([]);

  // 車両点検（Phase3・前後左右4方向）。in/outどちらの車両記録でも撮影可能（pre/postの比較用）。
  const [inInspectionPaths, setInInspectionPaths] = useState<Array<{ angle: InspectionAngle; path: string }>>([]);
  const [outInspectionPaths, setOutInspectionPaths] = useState<Array<{ angle: InspectionAngle; path: string }>>([]);
  const [outInspectionShots, setOutInspectionShots] = useState<InspectionShot[]>([]);
  const [inspectionUploading, setInspectionUploading] = useState(false);

  // --- ホーム表示用データ ---
  const { driver } = useAuth();
  const navigation = useNavigation<{ navigate: (name: string) => void; addListener: (ev: "focus", cb: () => void) => () => void }>();
  const today = reportDateDefaultJST();
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
    // 今日のシフト（待機状態のカード表示用）。車両一覧は WorkSessionProvider が持つ。
    apiFetch<{ shifts: MeShift[] }>(`/api/me/shifts?start=${today}&end=${today}`)
      .then((d) => setTodayShifts(d.shifts ?? []))
      .catch(() => setTodayShifts([]));
  }, [today]);

  /** 点検写真を Storage へ上げてパスに変換（1枚失敗しても業務は続行させる）。 */
  async function uploadInspection(target: "in" | "out", shots: InspectionShot[]) {
    if (shots.length === 0) return;
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

  /** 円の長押し → 統一キャプチャを開く。安全確認の抜き打ち判定はここで1回だけ引く。 */
  async function startCapture(target: "in" | "out") {
    setWorkMsg(null);
    if (!await refreshPhotoTasks()) { setWorkMsg("撮影項目を読み込めませんでした。もう一度お試しください。"); return; }
    if (target === "in") {
      const spot = Math.random() < SPOT_CHECK_RATE;
      setCaptureSteps(workCaptureSteps("in", true, spot ? "license" : "safety"));
    } else {
      setCaptureSteps(workCaptureSteps("out", true));
    }
    setCaptureFor(target);
  }

  function startParkingCapture() {
    setWorkMsg(null);
    setCaptureSteps(["meter"]);
    setCaptureFor("parking");
  }

  /** キャプチャ完了。撮影物を反映し、確認シート（出勤=車両確認 / 退勤=車両記録）へ繋ぐ。 */
  async function onCaptureComplete(result: CaptureResult) {
    const target = captureFor;
    setCaptureFor(null);
    if (!target) return;
    if (target === "parking") {
      if (!result.meterBase64) { setWorkMsg("メーター写真を撮影してください。"); return; }
      setParkingMeterBase64(result.meterBase64);
      return;
    }
    if (target === "in") setMeterBase64(result.meterBase64);
    if (target === "out") {
      setOutInspectionShots(result.inspection);
      setOutInspectionPaths([]);
    }

    // 点検写真のアップロードは待たせず裏で進める（確認シートには枚数が後から出る）
    void uploadInspection(target, result.inspection);
  }

  async function onScanIn(data: string): Promise<{ ok: true; vehicleLabel: string } | { ok: false; message: string }> {
    setBusy(true);
    setWorkMsg(null);
    try {
      const r = await resolveQr(data);
      if (!r.ok || !r.vehicle) {
        setWorkMsg(r.message ?? "読み取れませんでした。");
        return { ok: false, message: r.message ?? "このQRでは車両を確認できません。" };
      }
      setInVehicle(r.vehicle);
      setInToken(data);
      setInMethod("qr");
      setInFallbackVehicle(null);
      setInPlatePhotoPath(undefined);
      setInFallbackReason(undefined);
      return { ok: true, vehicleLabel: plateText(r.vehicle) };
    } catch (e) {
      setWorkMsg(errMsg(e));
      return { ok: false, message: errMsg(e) };
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
    setCaptureSteps(steps => steps.filter(step => step !== "qr"));
    setCaptureFor("in");
  }

  async function confirmIn() {
    if (!inToken && !inFallbackVehicle) return;
    if (!meterBase64) { setWorkMsg("メーター写真を撮影してください。"); return; }
    setBusy(true);
    setWorkMsg(null);
    try {
      const gps = await getGps();
      let odometerPhotoPath: string | undefined;
      if (meterBase64) {
        try {
          odometerPhotoPath = (await uploadMeterPhoto(meterBase64)).path;
        } catch {
          throw new Error("メーター写真を送信できませんでした。写真を残しています。もう一度送信してください。");
        }
      }
      const additionalPhotos = await uploadExtra("start");
      const res = await checkIn({
        ...(inToken
          ? { token: inToken }
          : { method: inMethod, vehicleId: inFallbackVehicle!.id, platePhotoPath: inPlatePhotoPath, fallbackReason: inFallbackReason }),
        odometer: null, // 写真からの解析値はサーバー側で別途確定する。
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
        inspectionPhotos: [...inInspectionPaths, ...additionalPhotos],
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "出勤に失敗しました。");
        return;
      }
      cancelIn();
      clearExtra("start");
      if (res.session?.id) {
        const started = await startVehicleTracking(res.session.id);
        if (!started) setWorkMsg("バックグラウンド位置情報を許可すると、稼働中の車の位置を共有できます。");
      }
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
    setMeterBase64(null);
    setInInspectionPaths([]);
    setInMethod("qr");
    setInFallbackVehicle(null);
    setInPlatePhotoPath(undefined);
    setInFallbackReason(undefined);
    setWorkMsg(null);
  }

  async function onScanOut(data: string): Promise<{ ok: true; vehicleLabel: string } | { ok: false; message: string }> {
    if (!open) return { ok: false, message: "稼働中の車両を確認できません。" };
    let vehicleLabel = "";
    try {
      const result = await resolveQr(data);
      if (!result.ok || !result.vehicle) return { ok: false, message: result.message ?? "このQRでは車両を確認できません。" };
      if (result.vehicle.id !== open.vehicle_id) return { ok: false, message: "稼働中の車両と異なります。車両のQRを読み取ってください。" };
      vehicleLabel = plateText(result.vehicle);
    } catch (e) {
      return { ok: false, message: errMsg(e) };
    }
    setOutToken(data);
    setOutMethod("qr");
    setOutFallbackVehicle(null);
    setOutPlatePhotoPath(undefined);
    setOutFallbackReason(undefined);
    return { ok: true, vehicleLabel };
  }

  function onOutFallbackResolved(result: FallbackResolution) {
    setFallbackOpenFor(null);
    setOutToken(null);
    setOutMethod(result.method);
    setOutFallbackVehicle(result.vehicle);
    setOutPlatePhotoPath(result.method === "plate_ocr" ? result.platePhotoPath : undefined);
    setOutFallbackReason(result.method === "manual" ? result.fallbackReason : undefined);
    setCaptureSteps(steps => steps.filter(step => step !== "qr"));
    setCaptureFor("out");
  }

  // 車両写真を送って業務を終了する。日報と駐車記録はそれぞれ独立して送信する。
  async function confirmOut() {
    if (!open || (!outToken && !outFallbackVehicle)) return;
    if (outInspectionShots.length !== 4) { setWorkMsg("車両の前・右・後・左を撮影してください。"); return; }
    setBusy(true);
    setWorkMsg(null);
    try {
      const gps = await getGps();
      const inspectionPhotos = [...outInspectionPaths];
      for (const shot of outInspectionShots) {
        if (inspectionPhotos.some(photo => photo.angle === shot.angle)) continue;
        try {
          const { path } = await uploadInspectionPhoto(shot.base64);
          inspectionPhotos.push({ angle: shot.angle, path });
        } catch {
          setOutInspectionPaths(inspectionPhotos);
          throw new Error("点検写真を送信できませんでした。写真を残しています。もう一度送信してください。");
        }
      }
      setOutInspectionPaths(inspectionPhotos);
      const additionalPhotos = await uploadExtra("end");
      const res = await checkOut({
        sessionId: open.id,
        ...(outToken
          ? { token: outToken }
          : { method: outMethod, vehicleId: outFallbackVehicle!.id, platePhotoPath: outPlatePhotoPath, fallbackReason: outFallbackReason }),
        odometer: null, // 写真からの解析値はサーバー側で別途確定する。
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        inspectionPhotos: [...inspectionPhotos, ...additionalPhotos],
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "業務終了に失敗しました。");
        return;
      }
      if (outParkingStatus === "handed_over") {
        await stopVehicleTracking();
        setParkingSessionId(null);
      } else {
        setParkingSessionId(open.id);
      }
      cancelOut();
      clearExtra("end");
      setWorkMsg(outParkingStatus === "handed_over" ? "業務を終了しました。" : "業務を終了しました。駐車後に車の場所を記録してください。");
      await reload();
    } catch (e) {
      setWorkMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelOut() {
    setOutToken(null);
    setMeterBase64(null);
    setOutInspectionPaths([]);
    setOutInspectionShots([]);
    setOutMethod("qr");
    setOutFallbackVehicle(null);
    setOutPlatePhotoPath(undefined);
    setOutFallbackReason(undefined);
    setOutParkingStatus("parked");
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
              <AppIcon name="bell" size={16} color="#454c56" iconStyle="solid" />
              {unreadCount > 0 && <View className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-accent-500" />}
            </Pressable>
            <Pressable
              className="w-10 h-10 rounded-full bg-white border border-brand-100 items-center justify-center active:opacity-70"
              onPress={() => navigation.navigate("マイページ")}
            >
              <AppIcon name="user" size={16} color="#454c56" iconStyle="solid" />
            </Pressable>
          </View>
        </View>

        {(workMsg || loadError) && (
          <View className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <Text className="text-amber-800 text-[13px]">{workMsg ?? loadError}</Text>
          </View>
        )}

        {!open && parkingSessionId && <Pressable
          className="min-h-14 flex-row items-center gap-3 rounded-xl border border-amber-300 bg-white px-4 py-3"
          onPress={() => { setParkingSheetOpen(true); void refreshPhotoTasks(); }} disabled={busy}
        >
          <AppIcon name="square-parking" size={18} color="#92400e" iconStyle="solid" />
          <Text className="flex-1 text-[14px] font-semibold text-brand-900">駐車した場所を記録</Text>
          {busy ? <ActivityIndicator size="small" /> : <AppIcon name="chevron-right" size={13} color="#92400e" iconStyle="solid" />}
        </Pressable>}

        {/* ヒーローカード: 挨拶＋バン積み込みアニメ＋今日のシフト */}
        <View className="bg-white rounded-2xl p-5 gap-1 shadow-sm">
          <Text className="text-[13px] text-brand-500">{greeting()}</Text>
          <Text className="text-xl font-bold text-brand-900">{driver.name} さん</Text>
          <HeroVan />
          <View className="gap-1.5 mb-3 mt-1">
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
              <AppIcon name="calendar-days" size={14} color="#454c56" iconStyle="solid" />
              <Text className="text-brand-800 font-medium text-[14px]">シフト・予定を確認</Text>
            </View>
            <AppIcon name="chevron-right" size={12} color="#a9b0b8" iconStyle="solid" />
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
              onTriggered={() => startCapture("in")}
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
                onTriggered={() => startCapture("out")}
              />
            </View>
            <Pressable
              className="border border-brand-300 rounded-lg py-2.5 items-center active:opacity-80"
              onPress={() => setReportSheetOpen(true)}
            >
              <Text className="text-white font-medium">日報を書く・修正する</Text>
            </Pressable>
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
                onTriggered={() => startCapture("in")}
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
              <AppIcon name="chevron-right" size={10} color="#a9b0b8" iconStyle="solid" />
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
                  <AppIcon name="bell" size={13} color={n.read_at ? "#7c848f" : "#d97706"} iconStyle="solid" />
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
              <AppIcon name={q.icon} size={18} color="#454c56" iconStyle="solid" />
              <Text className="text-[13px] text-brand-700 font-medium">{q.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* 出勤: キャプチャ後の車両確認・メーター確認（安全確認はフロー内で完了済み） */}
      <BottomSheet visible={inVehicle !== null && captureFor === null} scrollable>
        <Text className="text-[13px] text-brand-500">この車両で出勤します</Text>
        {workMsg && <Text accessibilityRole="alert" className="text-red-700">{workMsg}</Text>}
        {photoTasksError && <Text accessibilityRole="alert" className="text-red-700">撮影項目を読み込めませんでした。</Text>}
        {inVehicle && <VehicleIdentity vehicle={{ id: inVehicle.id, number_prefix: inVehicle.numberPrefix, number_class: inVehicle.numberClass, number_hiragana: inVehicle.numberHiragana, number_numeric: inVehicle.numberNumeric }} />}
        {meterBase64 ? <Text className="text-xs text-accent-600">メーター写真を添付しました</Text> : null}
        {inspectionUploading ? (
          <Text className="text-xs text-brand-400">点検写真をアップロード中...</Text>
        ) : inInspectionPaths.length > 0 ? (
          <Text className="text-xs text-accent-600">点検写真を{inInspectionPaths.length}枚添付しました</Text>
        ) : null}
        <ExtraPhotoFields tasks={tasksFor("start")} captured={Object.fromEntries(Object.keys(extraShots).map(id => [id, true]))} busy={busy || extraCapturing} onCapture={task => void captureExtra(task)} />
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => startCapture("in")}
          disabled={busy || inspectionUploading}
        >
          <Text className="text-brand-700 font-medium">撮り直す（メーター・点検）</Text>
        </Pressable>
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

      {/* 退勤: 車両撮影を送信後に業務終了。日報はいつでも別に送信する。 */}
      <BottomSheet visible={(outToken !== null || outFallbackVehicle !== null) && captureFor === null} scrollable>
        <Text className="text-[13px] text-brand-500">業務終了 — 車両記録</Text>
        {workMsg && <Text accessibilityRole="alert" className="text-red-700">{workMsg}</Text>}
        {photoTasksError && <Text accessibilityRole="alert" className="text-red-700">撮影項目を読み込めませんでした。</Text>}
        {inspectionUploading ? (
          <Text className="text-xs text-brand-400">点検写真をアップロード中...</Text>
        ) : outInspectionPaths.length > 0 ? (
          <Text className="text-xs text-accent-600">点検写真を{outInspectionPaths.length}枚添付しました</Text>
        ) : null}
        <ExtraPhotoFields tasks={tasksFor("end")} captured={Object.fromEntries(Object.keys(extraShots).map(id => [id, true]))} busy={busy || extraCapturing} onCapture={task => void captureExtra(task)} />
        <ParkingChoice value={outParkingStatus} onChange={setOutParkingStatus} />
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => startCapture("out")}
          disabled={busy || inspectionUploading}
        >
          <Text className="text-brand-700 font-medium">点検写真を撮り直す</Text>
        </Pressable>

        <View className="flex-row gap-2 mt-1">
          <Pressable
            className="flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80"
            onPress={() => void confirmOut()}
            disabled={busy || inspectionUploading || outInspectionShots.length !== 4}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white font-semibold">車両記録を送って業務終了</Text>}
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

      <BottomSheet visible={parkingSheetOpen && captureFor === null} scrollable>
        <View className="flex-row items-center justify-between"><Text className="text-xl font-bold text-brand-900">駐車の記録</Text><Pressable onPress={() => setParkingSheetOpen(false)} className="min-h-11 px-3 justify-center"><Text className="text-brand-600">閉じる</Text></Pressable></View>
        {workMsg && <Text accessibilityRole="alert" className="text-red-700">{workMsg}</Text>}
        {photoTasksError && <Text accessibilityRole="alert" className="text-red-700">撮影項目を読み込めませんでした。画面を開き直してください。</Text>}
        <Pressable onPress={startParkingCapture} disabled={busy} className="min-h-14 flex-row items-center gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3"><AppIcon name={parkingMeterBase64 ? "circle-check" : "camera"} size={17} color="#454c56" iconStyle="solid" /><Text className="flex-1 text-brand-900 font-medium">メーター</Text><Text className="text-brand-500 text-[12px]">{parkingMeterBase64 ? "撮影済み・撮り直す" : "必須"}</Text></Pressable>
        <ExtraPhotoFields tasks={tasksFor("parking")} captured={Object.fromEntries(Object.keys(extraShots).map(id => [id, true]))} busy={busy || extraCapturing} onCapture={task => void captureExtra(task)} />
        <Pressable onPress={() => { if (parkingMeterBase64) void completeParking(parkingMeterBase64); }} disabled={busy || extraCapturing || !parkingMeterBase64 || photoTasksError} className="min-h-14 items-center justify-center rounded-xl bg-accent-500 px-4 disabled:opacity-50"><Text className="text-white font-semibold">写真と駐車場所を記録</Text></Pressable>
      </BottomSheet>

      {/* ホームからの日報シート。稼働中も送れる。 */}
      <BottomSheet visible={reportSheetOpen} scrollable>
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-brand-900">日報</Text>
          <Pressable className="px-3 py-1.5 rounded-lg bg-brand-100 active:opacity-80" onPress={() => setReportSheetOpen(false)}>
            <Text className="text-brand-600">閉じる</Text>
          </Pressable>
        </View>
        <DailyReportForm date={today} showSubmitButton onSubmitted={() => setReportSheetOpen(false)} />
      </BottomSheet>

      {/* 統一フルスクリーンキャプチャ（案A）: QR〜点検を一筆書きで通す */}
      <CaptureFlow
        visible={captureFor !== null}
        steps={captureSteps}
        headline={captureFor === "out" ? "業務終了" : captureFor === "parking" ? "駐車の記録" : "稼働開始"}
        onQrScanned={captureFor === "out" ? onScanOut : onScanIn}
        onFallback={() => {
          const target = captureFor;
          setCaptureFor(null);
          if (target === "in" || target === "out") setFallbackOpenFor(target);
        }}
        onComplete={onCaptureComplete}
        onCancel={() => setCaptureFor(null)}
        allowSkipInspection={captureFor !== "out"}
      />

      <QrFallback
        visible={fallbackOpenFor !== null}
        vehicles={fallbackOpenFor === "out" ? outFallbackCandidates : vehicles}
        onResolved={fallbackOpenFor === "out" ? onOutFallbackResolved : onInFallbackResolved}
        onClose={() => setFallbackOpenFor(null)}
      />

    </View>
  );
}
