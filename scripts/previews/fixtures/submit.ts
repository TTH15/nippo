// 日報送信（本番 /submit の SubmitPageClientV2）用の架空データ。認証も外部へ送信しない。
// 送信内容は console.info("preview submit", …) に出す（アプリ内ブラウザから確認する）。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

const VEHICLES = [
  { id: "veh-1", number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "1201", plate_color: "black", manufacturer: "ホンダ", brand: "アクティ", current_mileage: 50000, is_ev: false, last_oil_change_mileage: 48000, oil_change_interval: 15000 },
  { id: "veh-2", number_prefix: "京都", number_class: "480", number_hiragana: "れ", number_numeric: "2752", plate_color: "black", manufacturer: "スズキ", brand: "エブリイ", current_mileage: 0, is_ev: false, last_oil_change_mileage: 0, oil_change_interval: 15000 },
];
const SHIFT = {
  courseId: "course-1", cycleNo: 1, cycleLabel: "1便", courseName: "北ルート", color: "#3b82f6", carrierId: "carrier-1", carrierName: "プレビュー運輸",
  units: [{ id: "unit-1", name: "宅配", code: "TAKUHAI", billingType: "PER_PIECE", fields: [
    { fieldKey: "delivered", label: "完了", inputType: "INT", groupLabel: "個数", required: true },
    { fieldKey: "undelivered", label: "持戻り", inputType: "INT", groupLabel: "個数", required: false },
  ] }],
  existing: null,
};
const PLACES = [
  { id: "place-toyonaka", name: "豊中センター", lat: 34.7855, lng: 135.4709, icon: "warehouse", slots: [
    { id: "slot-a1", label: "A-1", vehicleId: "veh-1" }, { id: "slot-a2", label: "A-2", vehicleId: null }, { id: "slot-a3", label: "A-3", vehicleId: "veh-2" },
  ] },
  { id: "place-kyoto", name: "京都車庫", lat: 35.0116, lng: 135.7681, icon: "warehouse", slots: [] },
  { id: "place-suita", name: "吹田 待機", lat: 34.7645, lng: 135.5158, icon: "parking", slots: [] },
];

type State = { places: typeof PLACES; submissions: unknown[]; phoneVerified: boolean; hasPasskey: boolean;
  recent: boolean; smsSent: boolean; challenge: string | null; attempts: number; statusFailures: number };

export const submitFixture: PreviewFixture<State> = {
  id: "submit",
  title: "日報入力・ログイン設定",
  pathname: "/submit",
  scenarios: {
    normal: { label: "通常", description: "車庫3件（豊中は区画あり・veh-1 は A-1 がいつもの）" },
    "no-places": { label: "車庫なし", description: "登録車庫が無い会社。別の場所と状況だけ選べる" },
    "sms-only": { label: "Passkey未登録", description: "SMS確認済み。本人確認後にPasskeyを登録する" },
    complete: { label: "設定済み", description: "SMS・Passkeyともに完了し、案内は表示しない" },
    "no-phone": { label: "電話番号なし", description: "保存済み番号がなく運営へ案内" },
    "setup-error": { label: "設定取得失敗", description: "最初の取得だけ失敗。再取得で戻る" },
    "key-error": { label: "Passkey保存失敗", description: "最初の登録だけ失敗。再試行で成功する" },
    "no-shifts": { label: "勤務予定なし", description: "当日の勤務予定がなくても未設定なら案内する" },
  },
  createState: ({ scenario }) => ({ places: scenario === "no-places" ? [] : PLACES, submissions: [],
    phoneVerified: ["sms-only", "complete"].includes(scenario), hasPasskey: scenario === "complete",
    recent: false, smsSent: false, challenge: null, attempts: 0, statusFailures: scenario === "setup-error" ? 1 : 0 }),
  read: (state, { path }, { scenario }) => {
    if (path === "/api/me/login-setup") {
      if (state.statusFailures-- > 0) throw new Error("設定を読み込めませんでした");
      return { phoneVerified: state.phoneVerified, phoneMasked: scenario === "no-phone" ? null : "下4桁 0000", hasPasskey: state.hasPasskey };
    }
    if (path === "/api/auth/reauth") return { recent: state.recent, canUseSms: state.phoneVerified, phoneMasked: "下4桁 0000", hasPasskey: state.hasPasskey };
    if (path === "/api/reports/profile") return { identities: [{ id: "identity-1", slot: 1, driverCode: "0123", officeCode: "45", label: "1つ目" }] };
    if (path === "/api/reports/vehicles-unlinked") return { vehicles: [] };
    if (path === "/api/reports/vehicles") return { vehicles: VEHICLES };
    if (path === "/api/reports/parking-places") return { places: state.places };
    if (path === "/api/me/report-form") return { shifts: scenario === "no-shifts" ? [] : [SHIFT], shiftVehicleId: "veh-1" };
    if (path === "/api/me/form-notice") return { notice: null };
    if (path === "/api/me/shift-deadline-reminder") return { reminder: null };
    if (path === "/api/me/submit-screen") return { todayReward: 12000, blocks: [{ id: "greeting", type: "greeting", title: "お疲れさまでした", message: "" }, { id: "reward", type: "today_reward", todayReward: 12000 }] };
    if (path.startsWith("/api/")) return {};
    return undefined;
  },
  write: (state, { path, method, body }, { scenario }) => {
    if (path === "/api/me/phone/send" || path === "/api/auth/reauth/options") {
      if (scenario === "no-phone") throw new Error("電話番号を運営にご確認ください");
      state.smsSent = true; return { ok: true };
    }
    if (path === "/api/me/phone/verify" || path === "/api/auth/reauth/verify") {
      if (!state.smsSent || body.code !== "123456") throw new Error("認証コードが正しくありません");
      state.phoneVerified = true; state.recent = true; state.smsSent = false;
      return { ok: true, reauthToken: "preview-sms-proof" };
    }
    if (path === "/api/auth/webauthn/register/options") {
      if (!state.recent) throw new Error("もう一度本人確認をしてください");
      state.challenge = `preview-key-${++state.attempts}`;
      return { options: {}, challengeToken: state.challenge };
    }
    if (path === "/api/auth/webauthn/register/verify") {
      if (!state.challenge || body.challengeToken !== state.challenge) throw new Error("登録をやり直してください");
      state.challenge = null;
      if (scenario === "key-error" && state.attempts === 1) throw new Error("Passkeyを保存できませんでした");
      state.hasPasskey = true; return { ok: true };
    }
    if (path === "/api/reports/v2" && method === "POST") {
      state.submissions.push(body);
      console.info("preview submit", JSON.stringify(body));
      return { ok: true, reportIds: ["report-1"], parkingSaved: (body.parking as { status?: string } | null)?.status === "parked" };
    }
    return undefined;
  },
};
