import { flowCandidates, readReportFlow, writeReportFlow, resetReportFlow } from "./reportLifecycle";
// 日報送信（本番 /submit の SubmitPageClientV2）用の架空データ。認証も外部へ送信しない。
// 送信内容は console.info("preview submit", …) に出す（アプリ内ブラウザから確認する）。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import { previewImageTemplate } from "./reportImageTemplates";

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
// 追加コースの「完了」も北ルートと同じ配完表の読み取り項目に対応させる。
const additionalCourses = flowCandidates.map(course => ({
  ...course,
  units: [{ ...SHIFT.units[0], fields: SHIFT.units[0].fields.filter(field => field.fieldKey === "delivered") }],
}));
const CYCLE_SHIFTS = [1, 2].map(cycleNo => ({ ...SHIFT, cycleNo, cycleLabel: `C${cycleNo}`, courseName: "日中サンプル",
  units: [{ ...SHIFT.units[0], fields: ["持出", "完了"].map((label, i) => ({ fieldKey: `${cycleNo === 1 ? "am" : "pm"}_${i ? "completed" : "mochidashi"}`,
    label, inputType: "INT", groupLabel: cycleNo === 1 ? "午前" : "午後", required: true })) }],
}));
const CYCLE_IMAGE_TEMPLATE = (() => {
  const base = previewImageTemplate({ unitId: "unit-1", doneKey: "am_completed", backKey: "am_mochidashi" });
  return { ...base,name: "便別入力の見本",definition: { ...base.definition,fields: CYCLE_SHIFTS.flatMap(shift => shift.units[0].fields.map(field => ({ ...base.definition.fields[1],id: field.fieldKey,role: "entry" as const,unitId: "unit-1",fieldKey: field.fieldKey,label: `${field.groupLabel} ${field.label}` }))) } };
})();
const PLACES = [
  { id: "place-toyonaka", name: "豊中センター", lat: 34.7855, lng: 135.4709, icon: "warehouse", slots: [
    { id: "slot-a1", label: "A-1", vehicleId: "veh-1" }, { id: "slot-a2", label: "A-2", vehicleId: null }, { id: "slot-a3", label: "A-3", vehicleId: "veh-2" },
  ] },
  { id: "place-kyoto", name: "京都車庫", lat: 35.0116, lng: 135.7681, icon: "warehouse", slots: [] },
  { id: "place-suita", name: "吹田 待機", lat: 34.7645, lng: 135.5158, icon: "parking", slots: [] },
];

type SourceImage = { id: string; report_date: string; status: string; received_at: string; original_filename: string | null; byte_size: number };

type State = { places: typeof PLACES; submissions: unknown[]; phoneVerified: boolean; hasPasskey: boolean;
  recent: boolean; smsSent: boolean; challenge: string | null; attempts: number; statusFailures: number;
  sourceImages: SourceImage[]; readings: unknown[]; imageTemplates: boolean; rewardFetchFailures: number };

type FixtureReceipt = { receiptKey: string; vehicleId: string | null; reportDate: string; stage: "required" | "not_required" | "complete"; attempts: number; resumeFailed?: boolean; pendingCourseCount?: number };
const PARKING_FIXTURE_PREFIX = "hakotora-preview-pwa-parking:";
function readParkingFixture(scenario: string): FixtureReceipt | null {
  try { return JSON.parse(sessionStorage.getItem(PARKING_FIXTURE_PREFIX + scenario) ?? "null") as FixtureReceipt | null; } catch { return null; }
}
function writeParkingFixture(scenario: string, value: FixtureReceipt | null) {
  if (value) sessionStorage.setItem(PARKING_FIXTURE_PREFIX + scenario, JSON.stringify(value));
  else sessionStorage.removeItem(PARKING_FIXTURE_PREFIX + scenario);
}
const vehicleReturnRequired = (scenario: string) =>
  scenario !== "parking-monthly" && !scenario.startsWith("post-") && scenario !== "reward-breakdown";

const fixtureParkingStage = (scenario: string, body: Record<string, unknown>) => {
  const items = (body.items ?? []) as { vehicleId?: string | null; request?: boolean }[];
  const vehicleId = items.find(item => item.vehicleId)?.vehicleId ?? null;
  const pendingCourseCount = items.filter(item => item.request).length;
  const stage = vehicleId && vehicleReturnRequired(scenario) ? "required" : "not_required";
  writeParkingFixture(scenario, { vehicleId, stage, reportDate: String(body.reportDate), receiptKey: String(body.clientKey), attempts: 0, pendingCourseCount });
  return { reportSaved: true, parkingStage: stage, parkingVehicleId: vehicleId };
};

export const submitFixture: PreviewFixture<State> = {
  id: "submit",
  title: "日報入力・ログイン設定",
  pathname: "/submit",
  scenarios: {
    "post-loading": { label: "送信後・報酬の計算中" },
    "post-slow": { label: "日報送信の連続バー", description: "架空の日報で、同じ「送信しています」画面のバーが進行し、完了へ切り替わる" },
    "post-error": { label: "報酬の読み込み失敗→再試行", description: "初回は失敗し、日報を再送せず金額を読み直す" },
    "post-zero": { label: "報酬が0円", description: "取得済みの0円は金額として表示" },
    "reward-breakdown": { label: "日報送信後・報酬内訳", description: "税込報酬・日額リースと承認待ちのコース追加を確認" },
    "image-multi": { label: "画像・同じ項目の複数コース",description: "反映先を選ぶまで数量を変更しない" },
    "image-reupload": { label: "画像・入力済み",description: "既存値と読み取り値を見比べて選んだ項目だけ変更する" },
    cycles: { label: "C1午前・C2午後", description: "実際の入力欄と便の色を確認し、別々の値を送信する" },
    "course-add": { label: "担当コースを追加", description: "担当しているC2と別コースだけ選択できる" },
    "no-course-options": { label: "追加候補なし", description: "当日シフトは残り、追加ボタンは出ない" },
    normal: { label: "通常", description: "車庫3件（豊中は区画あり・veh-1 は A-1 がいつもの）" },
    "parking-monthly": { label: "月額リース・駐車画面なし", description: "日報保存後は待機バーから完了へ" },
    "parking-device": { label: "駐車・端末の現在地", description: "端末の位置情報を許可すると、その周辺の地図をMapboxから取得。日報と返却はプレビュー内に保存" },
    "parking-permission": { label: "駐車・位置情報の許可", description: "駐車画面を開いた時にブラウザの許可を確認。地図・候補は架空地点" },
    "parking-near": { label: "駐車・近くに登録場所", description: "架空の測位から登録車庫を提案" },
    "parking-far": { label: "駐車・近くに登録場所なし", description: "架空の地図からピンを選ぶ" },
    "parking-denied": { label: "駐車・位置を取得できない", description: "許可なしでも候補またはピンを選ぶ" },
    "parking-map-error": { label: "駐車・地図エラー", description: "地図なしで登録場所から選ぶ" },
    "parking-resume-offline": { label: "再開時の通信切れ", description: "地図で再読み込みすると最初の照会だけ失敗。「もう一度確認」で駐車登録を再開" },
    "parking-response-lost": { label: "返却を保存した直後に通信切れ", description: "返却は記録済み。再読み込みか再試行で完了へ" },
    "parking-retry": { label: "駐車だけ再試行", description: "初回のみ駐車保存エラー" },
    "no-places": { label: "車庫なし", description: "登録車庫が無い会社。別の場所と状況だけ選べる" },
    "sms-only": { label: "かんたんログイン未設定", description: "SMS確認済み。本人確認後にかんたんログインを設定する" },
    complete: { label: "設定済み", description: "SMS・かんたんログインともに完了し、案内は表示しない" },
    "no-phone": { label: "電話番号なし", description: "保存済み番号がなく運営へ案内" },
    "setup-error": { label: "設定取得失敗", description: "最初の取得だけ失敗。再取得で戻る" },
    "key-error": { label: "設定失敗", description: "最初の設定だけ失敗。再試行で成功する" },
    "no-shifts": { label: "勤務予定なし", description: "当日の勤務予定がなくても未設定なら案内する" },
    "no-image-template": { label: "様式なし", description: "画像の様式が未登録。画像は残せるが件数は手入力" },
  },
  createState: ({ scenario }) => ({ places: scenario === "no-places" ? [] : PLACES, submissions: [],
    phoneVerified: scenario.startsWith("parking-") || ["sms-only", "complete", "cycles", "course-add", "no-course-options", "image-multi", "image-reupload", "reward-breakdown", "post-loading", "post-slow", "post-error", "post-zero"].includes(scenario), hasPasskey: scenario.startsWith("parking-") || ["complete", "cycles", "course-add", "no-course-options", "image-multi", "image-reupload", "reward-breakdown", "post-loading", "post-slow", "post-error", "post-zero"].includes(scenario),
    recent: false, smsSent: false, challenge: null, attempts: 0, statusFailures: scenario === "setup-error" ? 1 : 0,
    sourceImages: scenario === "image-reupload" ? ["confirmed", "received"].map((status, index) => ({
      id: `preview-image-${index + 1}`, status, original_filename: `sample-${index + 1}.png`,
      report_date: new Date().toISOString().slice(0, 10), received_at: new Date().toISOString(), byte_size: 120000,
    })) : [], readings: [], imageTemplates: scenario !== "no-image-template", rewardFetchFailures: scenario === "post-error" ? 1 : 0 }),
  onReset: ({ scenario }) => {
    resetReportFlow();
    writeParkingFixture(scenario, null);
    sessionStorage.removeItem("hakotora-pwa-parking-receipt");
  },
  isPending: (_state, { path }, { scenario }) => scenario === "post-loading" && path === "/api/me/submit-screen",
  read: (state, request, { scenario }) => {
    const { path } = request;
    if (path === "/api/reports/v2/parking") {
      const saved = readParkingFixture(scenario);
      if (!saved || saved.receiptKey !== request.params.get("key")) return { stage: "not_found" };
      if (scenario === "parking-resume-offline" && saved.stage === "required" && !saved.resumeFailed) {
        writeParkingFixture(scenario, { ...saved, resumeFailed: true });
        throw new Error("駐車場所の記録を確認できませんでした");
      }
      return { stage: saved.stage, reportDate: saved.reportDate, vehicleId: saved.vehicleId };
    }
    const flow = readReportFlow(request, scenario);
    if (flow !== undefined) return path === "/api/me/report-form" ? { ...flow as object, vehicleReturnRequired: vehicleReturnRequired(scenario) } : flow;
    if (path === "/api/me/login-setup") {
      if (state.statusFailures-- > 0) throw new Error("設定を読み込めませんでした");
      return { phoneVerified: state.phoneVerified, phoneMasked: scenario === "no-phone" ? null : "下4桁 0000", hasPasskey: state.hasPasskey };
    }
    if (path === "/api/auth/reauth") return { recent: state.recent, canUseSms: state.phoneVerified, phoneMasked: "下4桁 0000", hasPasskey: state.hasPasskey };
    if (path === "/api/reports/profile") return { identities: [{ id: "identity-1", slot: 1, driverCode: "0123", officeCode: "45", label: "1つ目" }] };
    if (path === "/api/reports/vehicles-unlinked") return { vehicles: [] };
    if (path === "/api/reports/vehicles") return { vehicles: VEHICLES };
    if (path === "/api/reports/parking-places") return { places: state.places };
    if (path === "/api/me/report-form" && (scenario.startsWith("parking-") || scenario === "normal" || scenario === "no-places" || scenario === "image-multi" || scenario === "reward-breakdown")) {
      const shifts = scenario === "image-multi" ? [SHIFT, { ...SHIFT, courseId: "course-2", courseName: "南ルート" }] : [SHIFT];
      return { shifts, vehicleReturnRequired: vehicleReturnRequired(scenario), candidates: additionalCourses, shiftVehicleId: "veh-1" };
    }
    if (path === "/api/me/report-form") return { vehicleReturnRequired: vehicleReturnRequired(scenario), shifts: scenario === "no-shifts" ? [] : scenario === "course-add" ? [CYCLE_SHIFTS[0]] : scenario === "image-reupload" ? CYCLE_SHIFTS.map(shift => ({ ...shift,existing: { vehicleId: "veh-1",meterValue: 50063,values: { "unit-1": Object.fromEntries(shift.units[0].fields.map((field,i) => [field.fieldKey,shift.cycleNo === 1 ? [71,63][i] : [52,47][i]])) } } })).reverse() : scenario === "cycles" ? [...CYCLE_SHIFTS].reverse() : [SHIFT], shiftVehicleId: "veh-1" };
    if (path === "/api/me/report-image-templates") {
      return { templates: state.imageTemplates ? [scenario === "cycles" || scenario === "image-reupload" ? CYCLE_IMAGE_TEMPLATE : (() => { const template=previewImageTemplate({ unitId: "unit-1", doneKey: "delivered", backKey: "undelivered" }); return scenario === "image-multi" ? { ...template,definition:{ ...template.definition,fields:template.definition.fields.filter(field => ["takkyubin-done","takkyubin-back"].includes(field.id)) } } : template; })()] : [] };
    }
    if (path === "/api/reports/source-images") return { images: state.sourceImages, unavailable: false };
    if (path === "/api/me/form-notice") return { notice: null };
    if (path === "/api/me/shift-deadline-reminder") return { reminder: null };
    if (path === "/api/me/submit-screen") {
      if (state.rewardFetchFailures > 0) {
        state.rewardFetchFailures -= 1;
        throw new Error("報酬の取得に失敗しました");
      }
      const zero = scenario === "post-zero";
      const receipt = readParkingFixture(scenario);
      const includedPendingCourseCount = receipt?.pendingCourseCount ?? (scenario === "reward-breakdown" ? 1 : 0);
      // 見本の日当は基本12,000円、追加の1コース・便につき税込3,000円。
      const todayReward = zero ? 0 : 12000 + 3000 * includedPendingCourseCount;
      return { todayReward, blocks: [
        { id: "greeting", type: "greeting", title: "お疲れさまでした", message: "" },
        { id: "reward", type: "today_reward", todayReward, breakdown: { beforeLease: zero ? 0 : todayReward + 2000, dailyLease: zero ? 0 : 2000, monthlyLease: false, includedPendingCourseCount } },
      ] };
    }
    if (path.startsWith("/api/")) return {};
    return undefined;
  },
  write: (state, request, { scenario, role }) => {
    const { path, method, body } = request;
    const flow = writeReportFlow(request, scenario, role); if (flow !== undefined) {
      return path === "/api/reports/v2" && body.parkingPolicy === "post_submit_map"
        ? { ...flow as object, ...fixtureParkingStage(scenario, body) } : flow;
    }
    if (path === "/api/reports/v2/parking" && method === "POST") {
      const receipt = readParkingFixture(scenario);
      if (!receipt || receipt.receiptKey !== body.receiptKey) throw new Error("保存済みの日報が見つかりません");
      if (receipt.stage === "complete") return { parkingSaved: true };
      const parking = body.parking as { vehicleId?: string; placeId?: string; coords?: { lat: number; lng: number } } | undefined;
      if (receipt.stage !== "required" || !parking || parking.vehicleId !== receipt.vehicleId || (!parking.placeId && !parking.coords)) {
        throw new Error("車を停めた場所を地図で確認してください");
      }
      ++receipt.attempts;
      if (scenario === "parking-retry" && receipt.attempts === 1) {
        writeParkingFixture(scenario, receipt);
        throw new Error("駐車場所を記録できませんでした");
      }
      receipt.stage = "complete";
      writeParkingFixture(scenario, receipt);
      if (scenario === "parking-response-lost") throw new Error("返却の保存結果を受信できませんでした");
      return { parkingSaved: true };
    }
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
      if (scenario === "key-error" && state.attempts === 1) throw new Error("かんたんログインを保存できませんでした");
      state.hasPasskey = true; return { ok: true };
    }
    if (path === "/api/reports/source-images" && method === "POST") {
      const image: SourceImage = {
        id: `preview-image-${state.sourceImages.length + 1}`,
        report_date: new Date().toISOString().slice(0, 10),
        status: "received",
        received_at: new Date().toISOString(),
        original_filename: ((body as { file?: { name?: string } }).file?.name) ?? "画像",
        byte_size: ((body as { file?: { size?: number } }).file?.size) ?? 120000,
      };
      state.sourceImages.push(image);
      // 作成日時は本番ではサーバーがファイルの中身から読む。スクショでは取れないことが多い
      return { id: image.id, duplicate: "none", capturedAt: null, capturedAtSource: "unknown" };
    }
    if (path === "/api/reports/source-images/readings" && method === "POST") {
      const reading = body as { sourceImageId?: string; adopted?: boolean };
      state.readings.push(reading);
      const image = state.sourceImages.find((row) => row.id === reading.sourceImageId);
      if (image) image.status = reading.adopted ? "confirmed" : "needs_review";
      // eslint-disable-next-line no-console
      console.info("preview reading", reading);
      return { reading: { id: `preview-reading-${state.readings.length}`, adopted: !!reading.adopted }, status: image?.status };
    }
    if (path === "/api/reports/v2" && method === "POST") {
      state.submissions.push(body);
      if (body.parkingPolicy === "post_submit_map") return { ok: true, ...fixtureParkingStage(scenario, body) };
      console.info("preview submit", JSON.stringify(body));
      return { ok: true, reportIds: ["report-1"], parkingSaved: (body.parking as { status?: string } | null)?.status === "parked" };
    }
    return undefined;
  },
};
