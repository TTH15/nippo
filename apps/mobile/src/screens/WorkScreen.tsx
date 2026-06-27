import { useCallback, useEffect, useState } from "react";
import { ScrollView, View, Text, Pressable, TextInput, ActivityIndicator } from "react-native";
import {
  fetchToday,
  resolveQr,
  checkIn,
  checkOut,
  uploadMeterPhoto,
  plateText,
  type WorkSession,
  type ResolvedVehicle,
} from "../api/work";
import { getGps } from "../location";
import { QrScanner } from "../components/QrScanner";
import { MeterScanner } from "../components/MeterScanner";

const INPUT =
  "border border-slate-300 rounded-lg px-3 py-2.5 text-base bg-white text-slate-900";

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

export function WorkScreen() {
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<WorkSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 出勤フロー（QR先頭 → 車両確認 → メーター → 確定）
  const [scanInVisible, setScanInVisible] = useState(false);
  const [inVehicle, setInVehicle] = useState<ResolvedVehicle | null>(null);
  const [inToken, setInToken] = useState<string | null>(null);
  const [inMeter, setInMeter] = useState("");

  // 退勤フロー（メーター入力 → 最後にQR）
  const [outInput, setOutInput] = useState(false);
  const [outMeter, setOutMeter] = useState("");
  const [scanOutVisible, setScanOutVisible] = useState(false);

  // メーター撮影。どちらの欄か＋撮影写真(base64、提出時にStorageへ)を保持。
  const [meterScanFor, setMeterScanFor] = useState<"in" | "out" | null>(null);
  const [meterBase64, setMeterBase64] = useState<string | null>(null);

  // 撮影確定：写真を保持し、OCRが読めていれば数値もプリフィル（手修正可）。
  function onMeterConfirmed(value: number | null, base64: string) {
    if (value != null) {
      if (meterScanFor === "in") setInMeter(String(value));
      else if (meterScanFor === "out") setOutMeter(String(value));
    }
    setMeterBase64(base64);
    setMeterScanFor(null);
  }

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const t = await fetchToday();
      setOpen(t.open);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // --- 出勤: QR読み取り → 車両解決 ---
  async function onScanIn(data: string) {
    setScanInVisible(false);
    setBusy(true);
    setMsg(null);
    try {
      const r = await resolveQr(data);
      if (!r.ok || !r.vehicle) {
        setMsg(r.message ?? "読み取れませんでした。");
        return;
      }
      setInVehicle(r.vehicle);
      setInToken(data);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // --- 出勤確定 ---
  async function confirmIn() {
    if (!inToken) return;
    setBusy(true);
    setMsg(null);
    try {
      const gps = await getGps();
      // メーター写真があれば先に Storage へ（失敗してもブロックしない＝写真なしで続行）。
      let odometerPhotoPath: string | undefined;
      if (meterBase64) {
        try {
          odometerPhotoPath = (await uploadMeterPhoto(meterBase64)).path;
        } catch {
          /* 写真アップロード失敗は無視 */
        }
      }
      const res = await checkIn({
        token: inToken,
        odometer: parseMeter(inMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
      });
      if (!res.ok) {
        setMsg(res.message ?? "出勤に失敗しました。");
        return;
      }
      setInVehicle(null);
      setInToken(null);
      setInMeter("");
      setMeterBase64(null);
      await reload();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelIn() {
    setInVehicle(null);
    setInToken(null);
    setInMeter("");
    setMeterBase64(null);
    setMsg(null);
  }

  // --- 退勤: 最後にQR ---
  async function onScanOut(data: string) {
    setScanOutVisible(false);
    if (!open) return;
    setBusy(true);
    setMsg(null);
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
        token: data,
        odometer: parseMeter(outMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
      });
      if (!res.ok) {
        setMsg(res.message ?? "退勤に失敗しました。");
        return;
      }
      setOutInput(false);
      setOutMeter("");
      setMeterBase64(null);
      await reload();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-slate-100">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-100" contentContainerClassName="p-4 pt-16 gap-3">
      <Text className="text-[26px] font-bold text-slate-900">業務</Text>

      {msg && (
        <View className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <Text className="text-amber-800 text-[13px]">{msg}</Text>
        </View>
      )}

      {busy && (
        <View className="flex-row items-center gap-2 py-1">
          <ActivityIndicator size="small" />
          <Text className="text-slate-500 text-[13px]">処理中…</Text>
        </View>
      )}

      {/* ① 出勤の車両確認（QR読み取り後） */}
      {inVehicle ? (
        <View className="bg-white rounded-xl p-4 gap-3 border border-slate-200">
          <Text className="text-[13px] text-slate-500">この車両で出勤します</Text>
          <Text className="text-xl font-bold text-slate-900">{plateText(inVehicle) || "車両"}</Text>
          <Text className="text-[13px] text-slate-500 mt-1">開始メーター（km）</Text>
          <TextInput
            className={INPUT}
            value={inMeter}
            onChangeText={(t) => setInMeter(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            placeholder="例: 123456"
          />
          <Pressable
            className="border border-slate-300 rounded-lg py-2.5 items-center active:opacity-80"
            onPress={() => setMeterScanFor("in")}
            disabled={busy}
          >
            <Text className="text-slate-700 font-medium">メーターをカメラで読み取り</Text>
          </Pressable>
          {meterBase64 ? <Text className="text-xs text-green-700">写真を添付しました</Text> : null}
          <View className="flex-row gap-2 mt-1">
            <Pressable
              className="flex-1 bg-slate-900 rounded-lg py-3 items-center active:opacity-80"
              onPress={confirmIn}
              disabled={busy}
            >
              <Text className="text-white font-semibold">出勤する</Text>
            </Pressable>
            <Pressable
              className="px-4 bg-slate-100 rounded-lg py-3 items-center active:opacity-80"
              onPress={cancelIn}
              disabled={busy}
            >
              <Text className="text-slate-600">やめる</Text>
            </Pressable>
          </View>
        </View>
      ) : open ? (
        // ② 稼働中（出勤済み）
        <View className="gap-3">
          <View className="bg-white rounded-xl p-4 gap-1 border border-slate-200">
            <View className="flex-row items-center gap-2">
              <View className="w-2 h-2 rounded-full bg-green-500" />
              <Text className="text-green-700 font-semibold">稼働中</Text>
            </View>
            <Text className="text-slate-500 text-[13px] mt-2">出勤時刻</Text>
            <Text className="text-slate-900 text-base font-semibold">{formatTime(open.started_at)}</Text>
            {open.start_odometer != null && (
              <>
                <Text className="text-slate-500 text-[13px] mt-2">開始メーター</Text>
                <Text className="text-slate-900 text-base font-semibold">{open.start_odometer} km</Text>
              </>
            )}
          </View>

          {outInput ? (
            <View className="bg-white rounded-xl p-4 gap-3 border border-slate-200">
              <Text className="text-[13px] text-slate-500">
                終了メーターを入力し、最後に車両のQRを読み取って業務終了します。
              </Text>
              <Text className="text-[13px] text-slate-500 mt-1">終了メーター（km）</Text>
              <TextInput
                className={INPUT}
                value={outMeter}
                onChangeText={(t) => setOutMeter(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="例: 123480"
              />
              <Pressable
                className="border border-slate-300 rounded-lg py-2.5 items-center active:opacity-80"
                onPress={() => setMeterScanFor("out")}
                disabled={busy}
              >
                <Text className="text-slate-700 font-medium">メーターをカメラで読み取り</Text>
              </Pressable>
              {meterBase64 ? <Text className="text-xs text-green-700">写真を添付しました</Text> : null}
              <Pressable
                className="bg-slate-900 rounded-lg py-3 items-center active:opacity-80 mt-1"
                onPress={() => setScanOutVisible(true)}
                disabled={busy}
              >
                <Text className="text-white font-semibold">QRを読み取って業務終了</Text>
              </Pressable>
              <Pressable
                className="py-2 items-center"
                onPress={() => {
                  setMeterBase64(null);
                  setOutInput(false);
                }}
                disabled={busy}
              >
                <Text className="text-slate-500">やめる</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              className="bg-slate-900 rounded-xl py-4 items-center active:opacity-80"
              onPress={() => {
                setMeterBase64(null);
                setOutInput(true);
              }}
              disabled={busy}
            >
              <Text className="text-white font-semibold text-base">退勤する</Text>
            </Pressable>
          )}
        </View>
      ) : (
        // ③ 未出勤
        <View className="gap-3">
          <Text className="text-slate-500 text-[13px]">
            乗務する車両のQRを読み取って出勤します。
          </Text>
          <Pressable
            className="bg-slate-900 rounded-xl py-5 items-center active:opacity-80"
            onPress={() => setScanInVisible(true)}
            disabled={busy}
          >
            <Text className="text-white font-bold text-base">出勤する（QRスキャン）</Text>
          </Pressable>
        </View>
      )}

      <QrScanner
        visible={scanInVisible}
        title="車両のQRを読み取って出勤"
        onScanned={onScanIn}
        onClose={() => setScanInVisible(false)}
      />
      <QrScanner
        visible={scanOutVisible}
        title="車両のQRを読み取って業務終了"
        onScanned={onScanOut}
        onClose={() => setScanOutVisible(false)}
      />
      <MeterScanner
        visible={meterScanFor !== null}
        onConfirm={onMeterConfirmed}
        onClose={() => setMeterScanFor(null)}
      />
    </ScrollView>
  );
}
