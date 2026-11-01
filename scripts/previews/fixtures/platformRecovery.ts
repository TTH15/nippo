import { accountFixture } from "./account";
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

export const platformRecoveryFixture: PreviewFixture<ReturnType<typeof accountFixture.createState>> = {
  ...accountFixture, id: "platform-recovery", title: "運営窓口・アカウント復旧", pathname: "/platform/account-recovery",
  scenarios: { normal: { label: "承認待ち", description: "本人確認後の承認と自己承認の禁止" }, empty: { label: "申請なし", description: "承認待ちがない状態" } },
  createState: context => { const state = accountFixture.createState({ ...context, scenario: "normal" }); if (context.scenario === "empty") state.requests = []; return state; },
  read: (state, request, context) => request.path === "/api/platform/account-recovery"
    ? { requests: state.requests.map(r => ({ ...r, companyName: "架空の配送会社" })) }
    : accountFixture.read(state, request, context),
  write: (state, request, context) => accountFixture.write!(state, { ...request, path: request.path === "/api/platform/account-recovery" ? "/api/admin/account-recovery" : request.path }, context),
};
