import { useState } from "react";
import { Modal, View, Text, Pressable, ScrollView, TextInput, Image } from "react-native";
import type { FieldRead, ReadTrust } from "@repo/core/logic/reportImageTemplate";

// ============================================================
// 画像から読み取った件数を、原本と見比べて直してから日報へ入れる（モバイル）。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-3 / RIMG-5）
//
// **毎回画像と見比べさせない。** 表の中の合計が全部閉じていれば、欄を取り違えていないことは
// 機械が示せる。そのときは数字だけを出して1タップで終える。
// 機械が確信を持てなかったときだけ、原本とその欄を切り出した画像を出して確かめてもらう。
// 読めなかった欄は空のままにする（0で埋めない）。
// ============================================================

export type ReviewRow = {
  fieldId: string;
  unitId: string;
  fieldKey: string;
  label: string;
  value: number | null;
  status: FieldRead["status"];
  cropUri: string | null;
};

const BADGE: Partial<Record<FieldRead["status"], string>> = {
  uncertain: "確認",
  out_of_range: "確認",
  not_found: "未取得",
  no_anchor: "未取得",
};

export function ReportImageReviewSheet({
  visible,
  templateName,
  imageUri,
  rows,
  warnings,
  trust,
  saving,
  onChange,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  templateName: string;
  imageUri: string;
  rows: ReviewRow[];
  warnings: string[];
  trust: ReadTrust;
  saving: boolean;
  onChange: (fieldId: string, value: number | null) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const verified = trust.level === "verified";
  const [showEvidence, setShowEvidence] = useState(!verified);
  const canConfirm = rows.some((row) => row.value != null) && !saving;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-white">
        <View className="flex-row items-center justify-between border-b border-brand-200 px-4 py-3">
          <Text className="text-base font-bold text-brand-900">読み取った件数</Text>
          {verified ? (
            <Text className="text-xs font-semibold text-accent-600">表の合計{trust.checksRun}本と一致</Text>
          ) : (
            <Text className="text-xs text-brand-500">{templateName}</Text>
          )}
        </View>

        <ScrollView className="flex-1 px-4 py-3" contentContainerClassName="gap-3">
          {showEvidence && imageUri ? (
            <Image
              source={{ uri: imageUri }}
              className="w-full rounded-lg border border-brand-200"
              style={{ aspectRatio: 16 / 9 }}
              resizeMode="contain"
            />
          ) : null}

          {trust.reasons.length > 0 && (
            <View className="gap-1 rounded-lg bg-amber-50 p-3">
              {trust.reasons.map((reason) => (
                <Text key={reason} className="text-xs text-amber-800">
                  {reason}
                </Text>
              ))}
            </View>
          )}

          {showEvidence && warnings.length > 0 && (
            <View className="gap-1 rounded-lg bg-brand-50 p-3">
              {warnings.map((warning) => (
                <Text key={warning} className="text-xs text-brand-700">
                  {warning}
                </Text>
              ))}
            </View>
          )}

          {rows.map((row) => (
            <View key={row.fieldId} className="flex-row items-center gap-3 border-b border-brand-100 py-2">
              <View className="flex-1">
                <Text className="text-sm text-brand-800">{row.label}</Text>
                {BADGE[row.status] ? <Text className="text-[11px] text-amber-700">{BADGE[row.status]}</Text> : null}
              </View>
              {showEvidence && row.cropUri ? (
                <Image
                  source={{ uri: row.cropUri }}
                  className="h-8 w-20 rounded border border-brand-200"
                  resizeMode="contain"
                />
              ) : null}
              <TextInput
                value={row.value == null ? "" : String(row.value)}
                onChangeText={(text) => {
                  const digits = text.replace(/[^0-9]/g, "");
                  onChange(row.fieldId, digits === "" ? null : Number(digits));
                }}
                keyboardType="number-pad"
                accessibilityLabel={row.label}
                className={`h-12 w-20 rounded-lg border px-3 text-right text-base ${
                  row.status === "read" ? "border-brand-300 bg-white" : "border-amber-400 bg-amber-50"
                }`}
              />
            </View>
          ))}
        </ScrollView>

        <View className="flex-row gap-2 border-t border-brand-200 px-4 py-3">
          {verified && !showEvidence ? (
            <Pressable
              onPress={() => setShowEvidence(true)}
              className="min-h-12 flex-1 items-center justify-center rounded-lg border border-brand-300"
            >
              <Text className="text-base text-brand-700">画像で確かめる</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onCancel}
            disabled={saving}
            className="min-h-12 flex-1 items-center justify-center rounded-lg border border-brand-300"
          >
            <Text className="text-base text-brand-700">手入力にする</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            disabled={!canConfirm}
            className={`min-h-12 flex-1 items-center justify-center rounded-lg bg-accent-500 ${canConfirm ? "" : "opacity-40"}`}
          >
            <Text className="text-base font-bold text-white">{saving ? "保存中…" : "日報に入れる"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
