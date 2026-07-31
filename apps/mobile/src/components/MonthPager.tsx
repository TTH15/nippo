import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { BottomSheet } from "./BottomSheet";

// ============================================================
// 月ナビゲーションの共通部品。
//   - MonthPager: 横スワイプで前月/翌月へなめらかに送る（前月/翌月ボタンは廃止）
//   - MonthTitle: 「2026年 7月 ▾」表示。タップで MonthPickerSheet を開く
//   - MonthPickerSheet: 年ステッパー + 12ヶ月グリッドで目当ての年月へ直接ジャンプ
// ============================================================

export type YM = { year: number; month: number }; // month は 1-12

export function addMonths(ym: YM, delta: number): YM {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 + 1 };
}

export const ymKey = (ym: YM) => `${ym.year}-${String(ym.month).padStart(2, "0")}`;

// 3ページ窓（前・当・次）を持ち、スクロール確定後に中央へ瞬時に戻すことで無限に月送りできる。
// ネイティブ依存（pager-view / gesture-handler）を増やさないため RN 標準の paging ScrollView で実装。
export function MonthPager({
  ym,
  onChange,
  renderMonth,
}: {
  ym: YM;
  onChange: (ym: YM) => void;
  /** isCenter=false は左右の覗きページ。重い内容はプレースホルダにしてよい。 */
  renderMonth: (ym: YM, isCenter: boolean) => ReactNode;
}) {
  const { width } = useWindowDimensions();
  const ref = useRef<ScrollView>(null);
  const key = ymKey(ym);

  useEffect(() => {
    // 月が変わったら（スワイプ確定・ピッカー選択とも）中央ページへ瞬時に戻す
    ref.current?.scrollTo({ x: width, animated: false });
  }, [key, width]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page !== 1) onChange(addMonths(ym, page - 1));
  };

  const pages = [addMonths(ym, -1), ym, addMonths(ym, 1)];
  return (
    <ScrollView
      ref={ref}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: width, y: 0 }}
      onMomentumScrollEnd={onMomentumEnd}
    >
      {pages.map((m, i) => (
        <View key={`${ymKey(m)}-${i}`} style={{ width }}>
          {renderMonth(m, i === 1)}
        </View>
      ))}
    </ScrollView>
  );
}

export function MonthTitle({ ym, onPress }: { ym: YM; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-center gap-1.5 py-1.5 active:opacity-70">
      <Text className="text-base font-semibold text-brand-900">
        {ym.year}年 {ym.month}月
      </Text>
      <FontAwesome6 name="chevron-down" size={11} color="#7c848f" iconStyle="solid" />
    </Pressable>
  );
}

const MONTH_ROWS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
];

export function MonthPickerSheet({
  visible,
  ym,
  onSelect,
  onClose,
}: {
  visible: boolean;
  ym: YM;
  onSelect: (ym: YM) => void;
  onClose: () => void;
}) {
  const [year, setYear] = useState(ym.year);

  useEffect(() => {
    if (visible) setYear(ym.year);
  }, [visible, ym.year]);

  return (
    <BottomSheet visible={visible}>
      <View className="flex-row items-center justify-between">
        <Pressable className="w-10 h-10 rounded-lg bg-brand-50 items-center justify-center active:opacity-70" onPress={() => setYear((y) => y - 1)}>
          <FontAwesome6 name="chevron-left" size={14} color="#454c56" iconStyle="solid" />
        </Pressable>
        <Text className="text-lg font-bold text-brand-900">{year}年</Text>
        <Pressable className="w-10 h-10 rounded-lg bg-brand-50 items-center justify-center active:opacity-70" onPress={() => setYear((y) => y + 1)}>
          <FontAwesome6 name="chevron-right" size={14} color="#454c56" iconStyle="solid" />
        </Pressable>
      </View>

      <View className="gap-2 mt-1">
        {MONTH_ROWS.map((row) => (
          <View key={row[0]} className="flex-row gap-2">
            {row.map((m) => {
              const selected = year === ym.year && m === ym.month;
              return (
                <Pressable
                  key={m}
                  className={`flex-1 py-3 rounded-lg items-center active:opacity-80 ${selected ? "bg-brand-900" : "bg-brand-50"}`}
                  onPress={() => {
                    onSelect({ year, month: m });
                    onClose();
                  }}
                >
                  <Text className={`text-[15px] font-medium ${selected ? "text-white" : "text-brand-800"}`}>{m}月</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <Pressable className="py-2.5 rounded-lg items-center bg-brand-100 active:opacity-80 mt-1" onPress={onClose}>
        <Text className="text-brand-600">閉じる</Text>
      </Pressable>
    </BottomSheet>
  );
}
