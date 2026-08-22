import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";
import type { VehiclePlateData } from "@repo/core/types";
import { VehiclePlateMini } from "../../components/VehiclePlateMini";

// ============================================================
// 運営モード・車両（最低限版）: 一覧＋「移動を記録」「写真を追加」。
// 移動記録は既存の出退勤API(work/check-in→check-out、method=manual・purpose=move)
// をその場で連続実行するだけの簡易版。QR/オドメーター等は求めない。
// 承認待ち(approval_status=pending)として記録され、既存の運営「勤怠」承認画面に乗る。
// 写真はWeb版admin/vehiclesと同じ方式（base64 data URLをそのままimage_urlへPUT）。
// ============================================================

type VehicleRow = VehiclePlateData & { id: string; image_url?: string | null; is_disposed?: boolean };

export function AdminVehiclesScreen() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<VehicleRow | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveMessage, setMoveMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ vehicles: VehicleRow[] }>("/api/admin/vehicles");
      // 故障・整備待ちの車両は、運営モードの「移動を記録」候補からも除外する。
      setVehicles((res.vehicles ?? []).filter((v) => !v.is_disposed && !v.is_unavailable));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const recordMove = async () => {
    if (!selected) return;
    setMoving(true);
    setMoveMessage("");
    try {
      const checkIn = await apiFetch<{ ok: boolean; message?: string; session?: { id: string } }>("/api/work/check-in", {
        method: "POST",
        body: JSON.stringify({ method: "manual", vehicleId: selected.id, purpose: "move" }),
      });
      if (!checkIn.ok || !checkIn.session) {
        setMoveMessage(checkIn.message || "移動の記録に失敗しました");
        return;
      }
      const checkOut = await apiFetch<{ ok: boolean; message?: string }>("/api/work/check-out", {
        method: "POST",
        body: JSON.stringify({ method: "manual", vehicleId: selected.id, sessionId: checkIn.session.id }),
      });
      setMoveMessage(checkOut.ok ? "移動を記録しました（運営承認待ち）" : checkOut.message || "移動の記録に失敗しました");
    } catch (e) {
      setMoveMessage(e instanceof Error ? e.message : "移動の記録に失敗しました");
    } finally {
      setMoving(false);
    }
  };

  const addPhoto = async (fromCamera: boolean) => {
    if (!selected) return;
    setMoveMessage("");
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setMoveMessage("写真へのアクセスが許可されていません");
        return;
      }
      const opts = { base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images } as const;
      const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const a = res.assets[0];
      const mime = a.mimeType || "image/jpeg";
      const dataUrl = `data:${mime};base64,${a.base64}`;
      setUploading(true);
      await apiFetch(`/api/admin/vehicles/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({ imageUrl: dataUrl }),
      });
      setSelected((v) => (v ? { ...v, image_url: dataUrl } : v));
      setVehicles((list) => list.map((v) => (v.id === selected.id ? { ...v, image_url: dataUrl } : v)));
      setMoveMessage("写真を追加しました");
    } catch (e) {
      setMoveMessage(e instanceof Error ? e.message : "写真の追加に失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-brand-50" contentContainerClassName="px-4 pt-16 pb-10 gap-3">
      <Text className="text-lg font-bold text-brand-900 mb-1">車両</Text>
      {error ? <Text className="text-red-600 text-[13px]">{error}</Text> : null}
      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : vehicles.length === 0 ? (
        <Text className="text-brand-500 text-[13px] text-center py-8">車両がありません</Text>
      ) : (
        <View className="flex-row flex-wrap gap-3">
          {vehicles.map((v) => (
            <Pressable
              key={v.id}
              className="w-[47%] bg-white rounded-lg border border-brand-200 p-3 gap-2 items-center"
              onPress={() => {
                setSelected(v);
                setMoveMessage("");
              }}
            >
              <VehiclePlateMini vehicle={v} />
              <Text className="text-[12px] text-brand-700" numberOfLines={1}>
                {[v.manufacturer, v.brand].filter(Boolean).join(" ") || "車両"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable className="flex-1 bg-black/40 justify-center p-6" onPress={() => setSelected(null)}>
          <Pressable className="bg-white rounded-xl p-5 gap-3" onPress={(e) => e.stopPropagation()}>
            {selected && (
              <>
                <Text className="text-base font-bold text-brand-900">
                  {[selected.manufacturer, selected.brand].filter(Boolean).join(" ") || "車両"}
                </Text>
                {selected.image_url ? (
                  <Image source={{ uri: selected.image_url }} style={{ width: "100%", height: 160, borderRadius: 8 }} resizeMode="cover" />
                ) : null}

                <Pressable
                  className={`py-3 rounded-lg items-center bg-brand-900 active:opacity-80 ${moving ? "opacity-50" : ""}`}
                  onPress={recordMove}
                  disabled={moving}
                >
                  {moving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">この車両の移動を記録</Text>}
                </Pressable>

                <View className="flex-row gap-2.5">
                  <Pressable
                    className={`flex-1 border border-brand-200 rounded-lg py-3 items-center bg-white active:opacity-80 ${uploading ? "opacity-50" : ""}`}
                    onPress={() => addPhoto(false)}
                    disabled={uploading}
                  >
                    <FontAwesome6 name="image" size={14} color="#454c56" iconStyle="solid" />
                    <Text className="text-brand-700 text-[12px] mt-1">ライブラリ</Text>
                  </Pressable>
                  <Pressable
                    className={`flex-1 border border-brand-200 rounded-lg py-3 items-center bg-white active:opacity-80 ${uploading ? "opacity-50" : ""}`}
                    onPress={() => addPhoto(true)}
                    disabled={uploading}
                  >
                    <FontAwesome6 name="camera" size={14} color="#454c56" iconStyle="solid" />
                    <Text className="text-brand-700 text-[12px] mt-1">カメラ</Text>
                  </Pressable>
                </View>

                {(moving || uploading) && !moveMessage ? null : moveMessage ? (
                  <Text className="text-[13px] text-brand-600 text-center">{moveMessage}</Text>
                ) : null}

                <Pressable className="py-2 items-center" onPress={() => setSelected(null)}>
                  <Text className="text-brand-500 text-[13px]">閉じる</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
