import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TASK_NAME = "hakotora-vehicle-location";
const SESSION_KEY = "hakotora_tracking_session";
const TOKEN_KEY = "nippo_token";
const QUEUE_KEY = "hakotora_vehicle_location_queue";
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://hakotora.jp").replace(/\/+$/, "");
type QueuedFix = { lat: number; lng: number; accuracyM: number; at: string };
type PendingQueue = { sessionId: string; fixes: QueuedFix[] };
let queueWork = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = queueWork.then(operation, operation);
  queueWork = next.then(() => {}, () => {});
  return next;
}

async function readQueue(sessionId: string): Promise<QueuedFix[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const queue = JSON.parse(raw) as PendingQueue;
    return queue.sessionId === sessionId && Array.isArray(queue.fixes) ? queue.fixes : [];
  } catch { return []; }
}

async function writeQueue(sessionId: string, fixes: QueuedFix[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify({ sessionId, fixes: fixes.slice(-1000) }));
}

export async function activeTrackingSessionId(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

async function stopNativeTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(TASK_NAME);
  }
}

export async function stopVehicleTracking() {
  await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
  await stopNativeTracking().catch(() => {});
  await serialize(() => AsyncStorage.removeItem(QUEUE_KEY)).catch(() => {});
}

async function sendLocation(sessionId: string, positions?: QueuedFix[]): Promise<boolean | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return false;
  const path = positions ? "/api/work/location" : `/api/work/location?sessionId=${encodeURIComponent(sessionId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: positions ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(positions ? { "Content-Type": "application/json" } : {}) },
      ...(positions ? { body: JSON.stringify({ sessionId, positions }) } : {}),
      signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }
  if (response.status === 401 || response.status === 403 || response.status === 404) return false;
  if (!response.ok) return null;
  const data = await response.json() as { tracking?: boolean };
  return data.tracking !== false;
}

export async function flushQueuedVehicleLocations(): Promise<boolean | null> {
  const sessionId = await activeTrackingSessionId();
  if (!sessionId) return false;
  return serialize(async () => {
    const queued = await readQueue(sessionId);
    if (queued.length === 0) return true;
    const tracking = await sendLocation(sessionId, queued.slice(0, 500));
    if (tracking === true) await writeQueue(sessionId, queued.slice(500));
    return tracking;
  });
}

export async function drainQueuedVehicleLocations() {
  for (let batch = 0; batch < 2; batch += 1) {
    const result = await flushQueuedVehicleLocations();
    if (result !== true) return;
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK_NAME, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const sessionId = await activeTrackingSessionId();
  if (!sessionId) { await stopNativeTracking(); return; }
  const positions = data.locations
    .filter((position) => position.coords.accuracy != null && position.coords.accuracy >= 0 && position.coords.accuracy <= 200)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((position) => ({ lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: position.coords.accuracy!, at: new Date(position.timestamp).toISOString() }));
  try {
    await serialize(async () => {
      const queued = await readQueue(sessionId);
      await writeQueue(sessionId, [...queued, ...positions]);
    });
    const tracking = await flushQueuedVehicleLocations();
    if (tracking === false) await stopVehicleTracking();
  } catch {
    // 位置は端末の待機列に残し、次の測位または起動時に再送する。
  }
});

async function ensureNativeTracking(requestPermission: boolean): Promise<boolean> {
  const foreground = requestPermission
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return false;
  const background = requestPermission
    ? await Location.requestBackgroundPermissionsAsync()
    : await Location.getBackgroundPermissionsAsync();
  if (!background.granted) return false;
  if (!await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
    await Location.startLocationUpdatesAsync(TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15_000,
      distanceInterval: 30,
      deferredUpdatesInterval: 15_000,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "車両の位置を共有中",
        notificationBody: "駐車の記録が完了するまで位置を更新します",
      },
    });
  }
  return true;
}

export async function startVehicleTracking(sessionId: string): Promise<boolean> {
  try {
    if (await activeTrackingSessionId() !== sessionId) await AsyncStorage.removeItem(QUEUE_KEY);
    await SecureStore.setItemAsync(SESSION_KEY, sessionId);
    return await ensureNativeTracking(true);
  } catch { return false; }
}

export async function reconcileVehicleTracking(openSessionId: string | null) {
  const saved = await activeTrackingSessionId();
  if (openSessionId && saved !== openSessionId) {
    await AsyncStorage.removeItem(QUEUE_KEY);
    await SecureStore.setItemAsync(SESSION_KEY, openSessionId);
  }
  const sessionId = openSessionId ?? saved;
  if (!sessionId) { await stopNativeTracking(); return; }
  try {
    if (!openSessionId) {
      const tracking = await sendLocation(sessionId);
      if (tracking === false) { await stopVehicleTracking(); return; }
    }
    const flushed = await flushQueuedVehicleLocations();
    if (flushed === false) { await stopVehicleTracking(); return; }
    if (await activeTrackingSessionId() !== sessionId) return;
    await ensureNativeTracking(false);
  } catch {
    // ネットワーク障害では追跡を止めず、次回起動・測位時に照合する。
  }
}
