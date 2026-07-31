import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";

// 通知インボックス。アプリ内インボックスが真実（LINE/Web Push は追加チャネル）— docs/notification-flow.md
// API: GET /api/me/notifications（新しい順）/ PATCH（ids or all で既読化）

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return "";
  }
}

export function NotificationsScreen() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<{ notifications: Notification[]; unreadCount: number }>("/api/me/notifications");
      setItems(d.notifications ?? []);
      setUnread(d.unreadCount ?? 0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "通知の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const markRead = async (ids: string[]) => {
    // 楽観更新（失敗しても次回ロードで正す）
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - ids.length));
    try {
      await apiFetch("/api/me/notifications", { method: "PATCH", body: JSON.stringify({ ids }) });
    } catch {
      /* noop */
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await apiFetch("/api/me/notifications", { method: "PATCH", body: JSON.stringify({ all: true }) });
    } catch {
      /* noop */
    }
  };

  const onPressItem = (n: Notification) => {
    setExpandedId((cur) => (cur === n.id ? null : n.id));
    if (!n.read_at) markRead([n.id]);
  };

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="pt-3 pb-10 px-4 gap-3"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {unread > 0 && (
        <View className="items-end">
          <Pressable className="px-3 py-1.5 rounded-lg bg-brand-100 active:opacity-80" onPress={markAllRead}>
            <Text className="text-brand-600 text-[13px]">すべて既読にする</Text>
          </Pressable>
        </View>
      )}

      {error ? (
        <View className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <Text className="text-amber-800 text-[13px]">{error}</Text>
        </View>
      ) : null}

      {items.length === 0 && !error ? (
        <View className="items-center py-16 gap-3">
          <FontAwesome6 name="bell-slash" size={28} color="#cfd3d8" iconStyle="solid" />
          <Text className="text-brand-300">通知はまだありません</Text>
        </View>
      ) : (
        items.map((n) => {
          const isUnread = !n.read_at;
          const expanded = expandedId === n.id;
          return (
            <Pressable
              key={n.id}
              className={`rounded-xl border p-3.5 gap-1 active:opacity-80 ${isUnread ? "bg-accent-50 border-accent-200" : "bg-white border-brand-100"}`}
              onPress={() => onPressItem(n)}
            >
              <View className="flex-row items-center gap-2">
                {isUnread && <View className="w-2 h-2 rounded-full bg-accent-500" />}
                <Text className={`flex-1 text-[15px] ${isUnread ? "font-bold text-brand-900" : "font-medium text-brand-700"}`} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text className="text-[11px] text-brand-400">{formatDateTime(n.created_at)}</Text>
              </View>
              <Text className="text-[13px] text-brand-600 leading-5" numberOfLines={expanded ? undefined : 2}>
                {n.body}
              </Text>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}
