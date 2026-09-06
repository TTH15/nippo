// "@/lib/map/sharedView" の差し替え。本物は Supabase Realtime に接続するため、プレビューでは常にオフ。
export function useSharedMapView(_opts: { getMap: () => unknown; selfName: string; active: boolean }) {
  return {
    participants: [] as { id: string; name: string; color: string; lngLat?: [number, number] }[],
    followingId: null as string | null,
    setFollowingId: (_id: string | null) => {},
    status: "off" as const,
    errorMsg: null as string | null,
    selfId: "preview-self",
  };
}
