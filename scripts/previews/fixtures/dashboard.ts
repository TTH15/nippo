// ダッシュボード（本番 /admin のページ本体）用の架空データ。3D地図は地図プレビューの fixture を共用。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import { mapFixture } from "./map";

type State = { scenario: string; badges: { dailyUnread: number; otherUnread: number; oilAlert: number; licenseAlert: number; pendingApproval: number }; activeDrivers: number; map: ReturnType<typeof mapFixture.createState> };

function dashboardMapState(context: Parameters<typeof mapFixture.createState>[0]) {
  const map = mapFixture.createState({ ...context, scenario: context.scenario === "large" ? "large" : context.scenario === "empty" ? "empty" : "normal" });
  map.vehicles.forEach((vehicle, index) => {
    if (vehicle.position) vehicle.position.at = new Date(Date.now() - (index + 1) * 60_000).toISOString();
  });
  if (context.scenario === "normal" && map.vehicles[3]?.position) {
    map.vehicles[3].position = { ...map.vehicles[3].position!, source: "gps", kind: "gps", parkingPending: true, driverName: "伊藤 蓮" };
  }
  if (context.scenario === "normal" && map.vehicles[2]?.position) {
    map.vehicles[2].position = { ...map.vehicles[2].position!, source: "report", kind: "report", placeName: "京都車庫" };
  }
  if (context.scenario === "normal" && map.vehicles[4]) {
    map.vehicles[4].session = { open: true, driverName: "田中 美咲", startedAt: new Date(Date.now() - 45 * 60_000).toISOString() };
  }
  return map;
}

export const dashboardFixture: PreviewFixture<State> = {
  id: "dashboard",
  title: "ダッシュボード",
  pathname: "/admin",
  scenarios: {
    normal: { label: "通常", description: "車両6台の稼働・駐車申告・最終位置・位置なし、要対応あり" },
    empty: { label: "位置なし", description: "全車両の位置なし・要対応なし・稼働0名" },
    large: { label: "40台", description: "車両40台と大きな要対応件数" },
  },
  createState: (context) => ({
    map: dashboardMapState(context),
    scenario: context.scenario,
    badges: context.scenario === "empty"
      ? { dailyUnread: 0, otherUnread: 0, oilAlert: 0, licenseAlert: 0, pendingApproval: 0 }
      : context.scenario === "large"
        ? { dailyUnread: 128, otherUnread: 34, oilAlert: 19, licenseAlert: 7, pendingApproval: 12 }
        : { dailyUnread: 3, otherUnread: 1, oilAlert: 2, licenseAlert: 1, pendingApproval: 1 },
    activeDrivers: context.scenario === "empty" ? 0 : context.scenario === "large" ? 312 : 9,
  }),
  read: (state, request, context) => {
    const { path, params } = request;
    if (path === "/api/admin/badges") return state.badges;
    if (path === "/api/admin/shifts" && params.get("countDrivers") === "1") return { count: state.activeDrivers };
    return mapFixture.read(state.map, request, context);
  },
  write: (state, request, context) => mapFixture.write?.(state.map, request, context),
};
