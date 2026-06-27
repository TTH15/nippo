import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

// 車両QRの読み取り（フルスクリーンのカメラモーダル）。
// QRを1回読み取ったら onScanned を呼ぶ（多重発火ガード）。
export function QrScanner({
  visible,
  title,
  onScanned,
  onClose,
}: {
  visible: boolean;
  title?: string;
  onScanned: (data: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (visible) {
      setHandled(false);
      if (permission && !permission.granted && permission.canAskAgain) {
        requestPermission();
      }
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (handled) return;
              setHandled(true);
              onScanned(data);
            }}
          />
        ) : (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-white text-center mb-4">
              QRの読み取りにはカメラの許可が必要です。
            </Text>
            <Pressable
              className="px-4 py-2 rounded-lg bg-white active:opacity-80"
              onPress={() => requestPermission()}
            >
              <Text className="text-slate-900 font-medium">カメラを許可</Text>
            </Pressable>
          </View>
        )}

        <View className="absolute top-0 left-0 right-0 pt-14 px-5">
          <Text className="text-white text-base font-semibold text-center">
            {title ?? "車両のQRを読み取ってください"}
          </Text>
        </View>

        <View className="absolute bottom-0 left-0 right-0 pb-12 items-center">
          <Pressable
            className="px-6 py-3 rounded-full bg-white/90 active:opacity-80"
            onPress={onClose}
          >
            <Text className="text-slate-900 font-medium">キャンセル</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
