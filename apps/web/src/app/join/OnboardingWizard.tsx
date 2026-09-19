"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faCircleCheck, faCommentSms } from "@fortawesome/free-solid-svg-icons";
import { faApple, faGooglePlay } from "@fortawesome/free-brands-svg-icons";
import { PasskeySetup } from "@/lib/components/PasskeySetup";
import { registerPasskey } from "@/lib/registerPasskey";
import { apiFetch, setAuth, getStoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { DATE_RE, fileToJpegBase64, uploadKycPhotoMultipart } from "@/lib/components/KycPhotoBox";
import { GuidedKycPhoto } from "@/lib/components/GuidedKycPhoto";
import { ocrLicenseExpiryFromBase64, prefetchLicenseOcr } from "@/lib/ocr/licenseExpiryOcr";

// ============================================================
// 初期登録ウィザード（web 一本化・§2-1a）。認証不要で開始し、SMS 認証後は
// pending のままセッションを受け取って本登録（KYC）まで一気に完了する。
// ようこそ(規約同意) → 氏名 → 生年月日 → 電話 → SMS認証 → Passkey（設定できない場合のみSMSで続行）
//   → 免許証 → 顔写真 → 住所 → 申請完了（アプリ導入の案内）
// 入口は ①単回招待リンク /join?invite=<token>（1回で消費）
//        ②共有参加コード ?code= / 手入力（口頭伝達フォールバック）。
//
// UI と通信を分離: 通信は WizardAdapter に集約し、本番は realAdapter（このファイル下部）、
// /preview/onboarding はモック adapter を注入して SMS・DB なしで何度でも試せる。
// UIUX の変更はこのファイル、通信仕様の変更は adapter を触る。
// ============================================================

export type Reg = {
  name: string;
  dob: string;
  licenseExpiry: string;
  hasLicensePhoto: boolean;
  hasFacePhoto: boolean;
  postalCode: string;
  address: string;
  /** 本人申告「住所は免許証記載と同じ」。null=未申告 */
  addressMatchesLicense?: boolean | null;
  bankName: string;
  bankNo: string;
  bankHolder: string;
  complete: boolean;
  kycVerified: boolean;
  hasPasskey?: boolean;
};

export type JoinPayload = {
  invite?: string;
  joinCode?: string;
  /** 「姓␣名」に合成済み（入力は姓・名分割＝表記揺れ防止） */
  name: string;
  /** 「セイ␣メイ」に合成済み（カタカナ） */
  nameKana: string;
  dob: string;
  phone: string;
  code: string;
  termsAgreed: boolean;
};

export type WizardAdapter = {
  /** 単回招待トークンの事前確認（org 表示名）。無効・使用済みは throw。 */
  lookupInvite(token: string): Promise<{ organizationName: string }>;
  /** 共有参加コードの事前確認（org 表示名）。 */
  lookupCode(code: string): Promise<{ organizationName: string }>;
  /** 保存済みセッションでの再開。可能なら登録状態を返し、不可なら null。 */
  tryResume(): Promise<Reg | null>;
  sendOtp(phone: string): Promise<void>;
  /** SMS 認証＋申請確定。セッションを確立し、続きの登録状態を返す（セッション無し受理は reg=null）。 */
  join(payload: JoinPayload): Promise<{ alreadyApplied: boolean; reg: Reg | null }>;
  /** Passkey（Face ID）登録。キャンセル等は NotAllowedError を throw。 */
  registerPasskey(): Promise<void>;
  getRegistration(): Promise<Reg>;
  saveRegistration(fields: Record<string, string | boolean>): Promise<void>;
  uploadPhoto(kind: "license" | "face", base64: string): Promise<void>;
};

type Step =
  | "loading"
  | "load-error"
  | "code"
  | "invite-invalid"
  | "welcome"
  | "name"
  | "phone"
  | "otp"
  | "passkey"
  | "address"
  | "license"
  | "face"
  | "done";

// 文字入力（住所）を先に済ませ、撮影（免許→顔）で締める並び。
const KYC_STEPS = ["address", "license", "face"] as const;
type KycStep = (typeof KYC_STEPS)[number];

const KYC_LABEL: Record<KycStep, string> = {
  address: "住所",
  license: "免許",
  face: "顔写真",
};

// サーバの complete 条件（値が入っているか）に揃える。
const isKycDone = (k: KycStep, r: Reg): boolean => {
  switch (k) {
    case "license":
      return r.hasLicensePhoto && !!r.licenseExpiry;
    case "face":
      return r.hasFacePhoto;
    case "address":
      return !!r.postalCode && !!r.address;
  }
};

const firstIncompleteKyc = (r: Reg): KycStep => {
  const k = KYC_STEPS.find((s) => !isKycDone(s, r));
  return k ?? KYC_STEPS[KYC_STEPS.length - 1];
};

const normalizeCode = (raw: string) =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

// ひらがな→カタカナ変換（フリガナ欄）。除去はしない — IME 変換中の書き換えは入力を
// 壊すため、変換は composition 確定時のみ・不正文字はバリデーションメッセージで伝える。
const toKatakana = (raw: string) =>
  raw.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/\s/g, "");
const KANA_RE = /^[ァ-ヶー]+$/;

// 全角数字→半角＋数字以外を除去（電話番号・認証コード）。IME 対応は transform 経由。
const toHalfWidthDigits = (raw: string) =>
  raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, "");
// SMS を受け取れる日本の携帯番号（060/070/080/090 の11桁）。固定電話は不可。
const JP_MOBILE_RE = /^0[6789]0\d{8}$/;
// 表示用: 090-1234-5678
const formatJPMobile = (digits: string) =>
  JP_MOBILE_RE.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : digits;

// 日付は select（年・月・日）で構成するため、不正な日付は構造的に入らない。
// iOS Safari では select が純正ホイールピッカーで開く（狙いの使用感・JS 不要）。
// アプリのストア URL（公開後に env で設定。未設定の間はボタンを「準備中」表示にする）。
const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL ?? "";
const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? "";
// アプリ公開前は「アプリで通知」等を約束しない（案内は運営から＝現運用の実態に合わせる）。
const STORES_READY = !!(APP_STORE_URL || PLAY_STORE_URL);

// 途中離脱対策: 申請確定（SMS認証）前の入力を「この端末の localStorage」にだけ残す。
// サーバには何も置かない＝同じ招待URLを別の人・別の端末が開いても入力内容は見えない。
// 申請確定後は不要になるため削除。24時間で自然失効。
const DRAFT_KEY = "nippo_join_draft";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
type Draft = {
  sei: string;
  mei: string;
  seiKana: string;
  meiKana: string;
  dobParts: DateParts;
  phone: string;
  termsAgreed: boolean;
  ts: number;
};
const loadDraft = (): Draft | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || typeof d !== "object" || Date.now() - (d.ts ?? 0) > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
};

const THIS_YEAR = new Date().getFullYear();
const DOB_YEARS = Array.from({ length: THIS_YEAR - 16 - 1920 + 1 }, (_, i) => THIS_YEAR - 16 - i);
const LICENSE_YEARS = Array.from({ length: 11 }, (_, i) => THIS_YEAR + i);
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

// 年月日ホイールの選択状態。「年だけ選んだ」等の途中状態も親で保持し、
// ステップを戻って再訪しても選択が消えないようにする。
type DateParts = { y: string; m: string; d: string };
const EMPTY_PARTS: DateParts = { y: "", m: "", d: "" };
const partsFromDate = (v: string): DateParts =>
  DATE_RE.test(v)
    ? { y: v.slice(0, 4), m: String(Number(v.slice(5, 7))), d: String(Number(v.slice(8, 10))) }
    : EMPTY_PARTS;
const composeParts = ({ y, m, d }: DateParts): string =>
  y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : "";

// ステップ表示（進捗バー）の並び。code/welcome/done は数えない。
const NUMBERED: Step[] = ["name", "phone", "otp", "passkey", "address", "license", "face"];
const STEP_TITLE: Record<string, string> = {
  name: "氏名・生年月日",
  phone: "電話番号",
  otp: "SMS認証",
  passkey: "ログイン設定",
  address: "住所",
  license: "免許証",
  face: "顔写真",
};

export function OnboardingWizard({
  adapter,
  passkeyOverride,
  initialInvite,
  persistDraft = true,
}: {
  /** 通信の実装。省略時は本番 API（realAdapter）。プレビューはモックを注入する。 */
  adapter?: WizardAdapter;
  /** Face ID ステップの表示を強制（プレビュー用）。省略時はホスト判定（rpID 一致時のみ）。 */
  passkeyOverride?: boolean;
  /** URL を使わず招待トークンを直接渡す（プレビュー用）。 */
  initialInvite?: string;
  /** 申請前入力の端末内保存（既定 ON。プレビューは OFF＝毎回まっさら）。 */
  persistDraft?: boolean;
}) {
  const api = useMemo(() => adapter ?? realAdapter, [adapter]);
  const hostCanUsePasskey = useIsWebAuthnHost();
  const canUsePasskey = passkeyOverride ?? hostCanUsePasskey;

  const [step, setStep] = useState<Step>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [passkeyDeferred, setPasskeyDeferred] = useState(false);

  // 免許ステップに近づいたら OCR モジュール（tesseract.js・数MB）を裏で温める。
  // 撮影→アップロード直後の初回 OCR で CDN 取得を待たないため（2026-08 監査）。
  useEffect(() => {
    if (step === "address" || step === "license") prefetchLicenseOcr();
  }, [step]);

  const [joinCode, setJoinCode] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [orgName, setOrgName] = useState("");
  const [sei, setSei] = useState("");
  const [mei, setMei] = useState("");
  const [seiKana, setSeiKana] = useState("");
  const [meiKana, setMeiKana] = useState("");
  const [dobParts, setDobParts] = useState<DateParts>(EMPTY_PARTS);
  const dob = composeParts(dobParts);
  // 免許有効期限のホイール状態（reg.licenseExpiry と同期。途中選択も保持）。
  const [licenseParts, setLicenseParts] = useState<DateParts>(EMPTY_PARTS);
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [reg, setReg] = useState<Reg | null>(null);
  const [previews, setPreviews] = useState<{ license?: string; face?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  // 免許有効期限の OCR プリフィル（読み取り中表示と、自動入力したことの案内）。
  const [expiryOcrBusy, setExpiryOcrBusy] = useState(false);
  const [expiryOcrFilled, setExpiryOcrFilled] = useState(false);
  const [expiryOcrFailed, setExpiryOcrFailed] = useState(false);
  // OCR 完了時に「手入力済みか」を同期的に判定するためのミラー
  // （state 更新関数の中でフラグを立てる方式は、更新関数が非同期実行のため使えない）。
  const licensePartsRef = useRef(licenseParts);
  useEffect(() => {
    licensePartsRef.current = licenseParts;
  }, [licenseParts]);

  // 住所ステップ: 「免許証記載と同じ」チェック（既定 ON）と郵便番号→住所の自動入力。
  const [addressSame, setAddressSame] = useState(true);
  const [postalBusy, setPostalBusy] = useState(false);
  const [postalNote, setPostalNote] = useState("");
  const addressAuto = useRef(""); // 自動入力した住所（手動編集後は上書きしない）
  // 建物名・部屋番号は別欄で入力し、保存時に「住所␣建物名」へ空白結合する（DB は単一カラムのまま。
  // 表示側は空白で改行できる）。サーバから戻った合成済み住所は最初の空白で分割して各欄へ戻す。
  const [building, setBuilding] = useState("");
  const splitAddress = (r: Reg): Reg => {
    const m = /^(\S+)\s+(.+)$/.exec((r.address ?? "").trim());
    setBuilding(m ? m[2] : "");
    return m ? { ...r, address: m[1] } : r;
  };

  // 表記揺れ防止: 姓・名は分割入力し、保存時に「姓␣名」へ合成（カナも同様）。
  const fullName = [sei.trim(), mei.trim()].filter(Boolean).join(" ");
  const fullKana = [seiKana.trim(), meiKana.trim()].filter(Boolean).join(" ");

  // フリガナの自動入力（autokana）: 漢字変換前の読みを拾ってカナ欄に追記する。
  // 手動編集された後は上書きしない（カナ欄が自動値のままの間だけ追記）。
  const seiKanaAuto = useRef("");
  const meiKanaAuto = useRef("");
  const appendKana = (auto: React.MutableRefObject<string>, set: (fn: (p: string) => string) => void) =>
    (k: string) =>
      set((prev) => {
        if (prev !== auto.current) return prev;
        auto.current = prev + k;
        return auto.current;
      });
  const handleNameInput = (
    setName: (v: string) => void,
    auto: React.MutableRefObject<string>,
    setKana: (fn: (p: string) => string) => void,
  ) =>
    (v: string) => {
      setName(v);
      // 氏名側を消したら、自動入力のままのカナも一緒に消す（手動編集済みは残す）。
      if (!v) {
        setKana((prev) => (prev === auto.current ? "" : prev));
        auto.current = "";
      }
    };

  // 入口の解決: ?invite=（単回）＞ ?code=（共有コード）＞ 手入力。
  // 既にログイン済み（申請途中で中断→再訪など）なら本登録の続きへ直接ジャンプする。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = initialInvite ?? (params.get("invite") ?? "").trim();
    const c = normalizeCode(params.get("code") ?? "");
    if (c.length >= 4) setJoinCode(c);

    // この端末に残っている申請前の下書きを復元（他端末には存在しない）。
    if (persistDraft) {
      const d = loadDraft();
      if (d) {
        setSei(d.sei ?? "");
        setMei(d.mei ?? "");
        setSeiKana(d.seiKana ?? "");
        setMeiKana(d.meiKana ?? "");
        if (d.dobParts && typeof d.dobParts.y === "string") {
          setDobParts({ y: d.dobParts.y ?? "", m: d.dobParts.m ?? "", d: d.dobParts.d ?? "" });
        }
        setPhone(d.phone ?? "");
        if (d.termsAgreed === true) setTermsAgreed(true);
      }
    }

    let cancelled = false;
    setStep("loading");
    setError("");
    (async () => {
      const resumeReg = await api.tryResume();
      if (cancelled) return;
      if (resumeReg) {
        setReg(splitAddress(resumeReg));
        setLicenseParts(partsFromDate(resumeReg.licenseExpiry));
        setAddressSame(resumeReg.addressMatchesLicense ?? true);
        setResumed(true);
        setStep(resumeReg.hasPasskey ? (resumeReg.complete ? "done" : firstIncompleteKyc(resumeReg)) : "passkey");
        return;
      }
      if (invite) {
        try {
          const res = await api.lookupInvite(invite);
          if (cancelled) return;
          setInviteToken(invite);
          setOrgName(res.organizationName);
          setStep("welcome");
        } catch (e) {
          // 招待経由の人に共有コードの入力を求めるのは導線として不自然なので、
          // コード入力に落とさず行き止まり画面にする。理由（使用済み/期限切れ/無効）は
          // サーバの文言をそのまま見出しに使う。
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "この招待リンクは無効です");
          setStep("invite-invalid");
        }
        return;
      }
      if (c.length >= 4) {
        try {
          const res = await api.lookupCode(c);
          if (cancelled) return;
          setOrgName(res.organizationName);
          setStep("welcome");
        } catch {
          if (cancelled) return;
          setStep("code");
        }
      } else {
        setStep("code");
      }
    })().catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : "登録内容を読み込めませんでした");
      setStep("load-error");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  const lookup = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.lookupCode(joinCode.trim().toUpperCase());
      setOrgName(res.organizationName);
      setStep("welcome");
    } catch (err) {
      setError(err instanceof Error ? err.message : "参加コードが確認できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      await api.sendOtp(phone.trim());
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "認証コードの送信に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  // SMS 認証 → 申請作成（pending）＋セッション受領 → 次のステップへ。
  const submitJoin = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.join({
        ...(inviteToken ? { invite: inviteToken } : { joinCode: joinCode.trim().toUpperCase() }),
        name: fullName,
        nameKana: fullKana,
        dob,
        phone: phone.trim(),
        code: otpCode.trim(),
        termsAgreed,
      });
      // 申請が確定したので端末内の下書きは破棄する。
      if (persistDraft) {
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          // 無視
        }
      }
      if (!res.reg) {
        // 稼働終了済み等でセッションを発行しないケース。申請自体は受理済み。
        setStep("done");
        return;
      }
      setReg(splitAddress(res.reg));
      setLicenseParts(partsFromDate(res.reg.licenseExpiry));
      setAddressSame(res.reg.addressMatchesLicense ?? true);
      setResumed(res.alreadyApplied);
      setStep(res.reg.hasPasskey ? (res.reg.complete ? "done" : firstIncompleteKyc(res.reg)) : "passkey");
    } catch (err) {
      setError(err instanceof Error ? err.message : "申請に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const setRegField = (k: keyof Reg, v: string) => setReg((r) => (r ? { ...r, [k]: v } : r));

  // 申請前入力の自動保存（端末内のみ）。入力が何かあるときだけ書く。
  useEffect(() => {
    if (!persistDraft) return;
    const hasInput =
      sei || mei || seiKana || meiKana || phone || dobParts.y || dobParts.m || dobParts.d || termsAgreed;
    if (!hasInput) return;
    try {
      const draft: Draft = { sei, mei, seiKana, meiKana, dobParts, phone, termsAgreed, ts: Date.now() };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // localStorage 不可（プライベートモード等）は保存なしで続行
    }
  }, [persistDraft, sei, mei, seiKana, meiKana, dobParts, phone, termsAgreed]);

  // 縦の引っ張りバウンス（オーバースクロール）を抑制して app 的な触感にする。
  // ルートは 100dvh 基準なので、収まっている画面ではそもそもスクロールが発生しない。
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.overscrollBehaviorY;
    el.style.overscrollBehaviorY = "none";
    return () => {
      el.style.overscrollBehaviorY = prev;
    };
  }, []);

  // 郵便番号→住所の自動入力（zipcloud・admin 画面と同じ API）。
  // 7桁揃った時点で検索し、住所が空 or 前回の自動入力のままの場合だけ上書きする。
  const handlePostal = (raw: string) => {
    const zip = raw.replace(/\D/g, "").slice(0, 7);
    setRegField("postalCode", zip);
    setPostalNote("");
    if (zip.length !== 7) return;
    setPostalBusy(true);
    fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`)
      .then((res) => res.json())
      .then((data) => {
        const r = data?.status === 200 ? data.results?.[0] : null;
        if (!r) {
          setPostalNote("郵便番号から住所が見つかりませんでした。住所欄に直接入力してください。");
          return;
        }
        const addr = [r.address1, r.address2, r.address3].filter(Boolean).join("");
        setReg((prev) => {
          if (!prev) return prev;
          if (prev.address && prev.address !== addressAuto.current) return prev; // 手動入力を尊重
          addressAuto.current = addr;
          return { ...prev, address: addr };
        });
      })
      .catch(() => {
        // 検索失敗は手入力で続行できるため黙って無視
      })
      .finally(() => setPostalBusy(false));
  };

  const uploadPhoto = async (kind: "license" | "face", file: File) => {
    setError("");
    setBusy(true);
    try {
      const base64 = await fileToJpegBase64(file);
      if (!base64) throw new Error("画像の変換に失敗しました");
      await api.uploadPhoto(kind, base64);
      setReg((r) => (r ? { ...r, [kind === "license" ? "hasLicensePhoto" : "hasFacePhoto"]: true } : r));
      setPreviews((p) => ({ ...p, [kind]: `data:image/jpeg;base64,${base64}` }));
      // 免許写真から有効期限を OCR プリフィル（未入力のときだけ・非同期で裏実行）。
      if (kind === "license" && !reg?.licenseExpiry) void runExpiryOcr(base64);
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  // 有効期限の OCR。読めたらホイールへ反映するが、その間にユーザーが手で
  // 選んでいたら上書きしない。読めなかったときは控えめに一言だけ出す。
  const runExpiryOcr = async (base64: string) => {
    setExpiryOcrBusy(true);
    setExpiryOcrFailed(false);
    try {
      const found = await ocrLicenseExpiryFromBase64(base64);
      const y = found ? Number(found.slice(0, 4)) : 0;
      const inRange = !!found && y >= THIS_YEAR && y <= THIS_YEAR + 10; // ホイールの選択肢範囲
      const cur = licensePartsRef.current;
      const untouched = !cur.y && !cur.m && !cur.d;
      if (!inRange) {
        if (untouched) setExpiryOcrFailed(true);
        return;
      }
      if (!untouched) return; // 手入力を尊重
      setLicenseParts(partsFromDate(found!));
      setReg((r) => (r && !r.licenseExpiry ? { ...r, licenseExpiry: found! } : r));
      setExpiryOcrFilled(true);
    } finally {
      setExpiryOcrBusy(false);
    }
  };

  // KYC ステップの保存＋前進。最後（face）はサーバの complete を確認して完了へ。
  const nextKyc = async () => {
    if (!reg) return;
    setError("");
    setBusy(true);
    try {
      if (step === "address") {
        // 住所欄内の空白は除去して保存する（日本の住所表記に空白は不要）。これにより
        // 保存値の空白＝建物名との区切り、が一意に決まる（単一カラムのままで曖昧さなし）。
        await api.saveRegistration({
          postalCode: reg.postalCode,
          address: [reg.address.replace(/\s+/g, ""), building.trim()].filter(Boolean).join(" "),
          addressMatchesLicense: addressSame,
        });
        setStep("license");
      } else if (step === "license") {
        await api.saveRegistration({ licenseExpiry: reg.licenseExpiry, ...(reg.dob ? { dob: reg.dob } : {}) });
        setStep("face");
      } else if (step === "face") {
        const fresh = await api.getRegistration();
        setReg(splitAddress(fresh));
        if (fresh.complete) {
          setStep("done");
        } else {
          const missing = KYC_STEPS.filter((k) => !isKycDone(k, fresh));
          setStep(firstIncompleteKyc(fresh));
          setError(`未入力の項目があります（${missing.map((k) => KYC_LABEL[k]).join("・")}）`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const canProceed = (() => {
    switch (step) {
      case "name":
        return !!sei.trim() && !!mei.trim() && KANA_RE.test(seiKana) && KANA_RE.test(meiKana) && !!dob;
      case "phone":
        return JP_MOBILE_RE.test(phone);
      case "otp":
        return otpCode.length === 6;
      case "license":
        return !!reg && reg.hasLicensePhoto && DATE_RE.test(reg.licenseExpiry);
      case "face":
        return !!reg && reg.hasFacePhoto;
      case "address":
        return !!reg && !!reg.postalCode.trim() && !!reg.address.trim();
      default:
        return true;
    }
  })();

  const inputCls =
    "w-full py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors";
  const btnCls =
    "w-full py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
  const backBtnCls = "w-full text-sm text-slate-500 hover:text-slate-700";

  // 非対応でもログイン方法を確認してから本登録へ進む。
  const numbered = NUMBERED;
  const stepIndex = numbered.indexOf(step);
  const showProgress = stepIndex >= 0;

  // 申請確定（SMS認証）前は自由に戻れる。確定後は KYC ステップ間のみ戻れる
  // （address より前へは戻さない＝氏名・電話の入力し直しは申請済みのため不可）。
  const back = () => {
    setError("");
    if (step === "name") setStep("welcome");
    else if (step === "phone") setStep("name");
    else if (step === "otp") setStep("phone");
    else if (step === "license") setStep("address");
    else if (step === "face") setStep("license");
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-100 px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="p-3 border-b border-slate-200 flex flex-col items-center gap-2">
            <img
              src="/logo/hakotora-logo_secondary_logo.svg"
              alt="ロゴ"
              className="h-12"
              style={{ maxWidth: "60%", height: "auto" }}
            />
            <h1 className="text-base font-semibold text-slate-900">
              {step === "done" ? "申請完了" : "初期登録"}
            </h1>
            {showProgress && (
              <div className="w-full">
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>
                    {stepIndex + 1} / {numbered.length}　{STEP_TITLE[step]}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full bg-slate-900 transition-all"
                    style={{ width: `${Math.round(((stepIndex + (canProceed ? 1 : 0)) / numbered.length) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* key={step} でステップ切替のたびに soft-rise（フェード＋わずかに上昇）を再生 */}
          <div className="p-5">
          <div key={step} className="space-y-4 soft-rise">
            {resumed && ["license", "face", "address"].includes(step) && (
              <p className="text-xs text-slate-500 text-center bg-slate-50 rounded-lg py-2">
                前回の続きから再開しています
              </p>
            )}
            {step === "loading" && <p role="status" className="text-center text-sm text-slate-500">登録内容を確認中...</p>}
            {step === "load-error" && <div className="space-y-4">
              <p role="alert" className="text-center text-sm text-red-600">{error}</p>
              <button onClick={() => setLoadAttempt((n) => n + 1)} className={btnCls}>もう一度読み込む</button>
            </div>}

            {step === "invite-invalid" && (
              <p className="text-sm font-medium text-slate-900 text-center py-4">
                {error || "この招待リンクは無効です"}
              </p>
            )}
            {step === "code" && (
              <>
                <p className="text-sm text-slate-600">運営から受け取った参加コードを入力してください。</p>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(normalizeCode(e.target.value))}
                  className="w-full text-center text-lg tracking-widest font-mono py-2.5 px-1 bg-transparent border-0 border-b-2 border-slate-200 rounded-none focus:border-slate-900 focus:outline-none transition-colors"
                  placeholder="ABC123"
                  autoComplete="off"
                />
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={lookup} disabled={busy || joinCode.trim().length < 4} className={btnCls}>
                  {busy ? "確認中..." : "確認"}
                </button>
              </>
            )}

            {step === "welcome" && (
              <div className="space-y-4">
                <div className="text-center space-y-1 py-2">
                  <p className="text-lg font-bold text-slate-900">ようこそ</p>
                  <p className="text-sm text-slate-700">
                    <span className="font-bold">{orgName}</span> の初期登録を始めます。
                  </p>
                </div>
                <ul className="text-sm text-slate-600 space-y-1.5 bg-slate-50 rounded-lg p-4">
                  <li>・所要時間は約5分です</li>
                  <li>・SMS を受け取れる携帯電話番号が必要です</li>
                  <li>・運転免許証を手元にご用意ください</li>
                  <li>・免許証と顔の撮影があります</li>
                </ul>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={termsAgreed}
                    onChange={(e) => setTermsAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900"
                  />
                  <span className="text-sm text-slate-600">
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">
                      利用規約
                    </a>
                    と
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">
                      プライバシーポリシー
                    </a>
                    に同意します
                  </span>
                </label>
                <button onClick={() => { setError(""); setStep("name"); }} disabled={!termsAgreed} className={btnCls}>
                  はじめる
                </button>
                {!inviteToken && (
                  <BackLink onClick={() => { setStep("code"); setError(""); }}>コードを入れ直す</BackLink>
                )}
              </div>
            )}

            {step === "name" && (
              <>
                <div className="pt-3 pb-2 space-y-8">
                  <div>
                    <p className="text-xs font-medium text-slate-400 mb-1">氏名</p>
                    <div className="flex gap-6">
                    <FloatingLineField
                      label="姓"
                      value={sei}
                      onChange={handleNameInput(setSei, seiKanaAuto, setSeiKana)}
                      onKanaComposed={appendKana(seiKanaAuto, setSeiKana)}
                      autoComplete="family-name"
                    />
                    <FloatingLineField
                      label="名"
                      value={mei}
                      onChange={handleNameInput(setMei, meiKanaAuto, setMeiKana)}
                      onKanaComposed={appendKana(meiKanaAuto, setMeiKana)}
                      autoComplete="given-name"
                    />
                    </div>
                    <div className="flex gap-6 mt-7">
                      <FloatingLineField label="セイ" value={seiKana} onChange={setSeiKana} transform={toKatakana} />
                      <FloatingLineField label="メイ" value={meiKana} onChange={setMeiKana} transform={toKatakana} />
                    </div>
                    {((seiKana && !KANA_RE.test(seiKana)) || (meiKana && !KANA_RE.test(meiKana))) && (
                      <p className="text-xs text-red-500 mt-3">フリガナはカタカナで入力してください</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2">生年月日</label>
                    <DateWheelField parts={dobParts} onChange={setDobParts} years={DOB_YEARS} />
                  </div>
                </div>
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={() => setStep("phone")} disabled={!canProceed} className={btnCls}>
                  次へ
                </button>
              </>
            )}

            {step === "phone" && (
              <>
                <div className="pt-3 pb-1">
                  <FloatingLineField
                    label="電話番号（携帯）"
                    value={phone}
                    onChange={(v) => setPhone(toHalfWidthDigits(v).slice(0, 11))}
                    transform={(v) => toHalfWidthDigits(v).slice(0, 11)}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                  />
                </div>
                {phone.length === 11 && !JP_MOBILE_RE.test(phone) && (
                  <p className="text-xs text-red-500">携帯電話番号（090・080・070 など）を入力してください</p>
                )}
                <p className="text-xs text-slate-400">この番号に SMS で認証コードを送ります。</p>
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={sendCode} disabled={busy || !canProceed} className={btnCls}>
                  {busy ? "送信中..." : "認証コードを送信"}
                </button>
              </>
            )}

            {step === "otp" && (
              <>
                <div className="flex justify-center pt-2">
                  <FontAwesomeIcon icon={faCommentSms} className="h-9 w-9 text-slate-400" />
                </div>
                <p className="text-sm text-slate-600 text-center">
                  {formatJPMobile(phone)} に送った
                  <br />
                  6桁の認証コードを入力してください。
                </p>
                <OtpSlots value={otpCode} onChange={setOtpCode} />
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={submitJoin} disabled={busy || !canProceed} className={btnCls}>
                  {busy ? "確認中..." : "認証して進む"}
                </button>
                <button onClick={sendCode} disabled={busy} className="w-full text-sm text-blue-600 hover:text-blue-800">
                  コードを再送する
                </button>
              </>
            )}

            {step === "passkey" && reg && (
              <PasskeySetup verifyIdentity={api === realAdapter} supported={canUsePasskey} register={api.registerPasskey}
                onContinue={(registered) => {
                  setPasskeyDeferred(!registered);
                  if (registered) setReg((current) => current ? { ...current, hasPasskey: true } : current);
                  setStep(reg.complete ? "done" : firstIncompleteKyc(reg));
                }} />
            )}

            {step === "license" && reg && (
              <>
                <GuidedKycPhoto
                  kind="license"
                  title="運転免許証の写真（正面）"
                  done={reg.hasLicensePhoto}
                  previewUri={previews.license}
                  busy={busy}
                  onPick={(f) => uploadPhoto("license", f)}
                />
                <div className="pt-1 pb-2">
                  <label className="block text-xs font-medium text-slate-400 mb-2">
                    免許証の有効期限
                    {expiryOcrBusy && <span className="ml-2 text-slate-400">写真から読み取り中...</span>}
                  </label>
                  <DateWheelField
                    parts={licenseParts}
                    onChange={(p) => {
                      setLicenseParts(p);
                      setRegField("licenseExpiry", composeParts(p));
                      setExpiryOcrFilled(false);
                    }}
                    years={LICENSE_YEARS}
                  />
                  {expiryOcrFilled && (
                    <p className="mt-2 text-xs text-emerald-600">
                      写真から自動入力しました。違っていれば選び直してください。
                    </p>
                  )}
                  {expiryOcrFailed && (
                    <p className="mt-2 text-xs text-slate-400">
                      写真から読み取れませんでした。有効期限を選択してください。
                    </p>
                  )}
                </div>
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={nextKyc} disabled={busy || !canProceed} className={btnCls}>
                  {busy ? "保存中..." : "次へ"}
                </button>
                <BackLink onClick={back} disabled={busy} />
              </>
            )}

            {step === "face" && reg && (
              <>
                <GuidedKycPhoto
                  kind="face"
                  title="顔写真"
                  done={reg.hasFacePhoto}
                  previewUri={previews.face}
                  busy={busy}
                  onPick={(f) => uploadPhoto("face", f)}
                />
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={nextKyc} disabled={busy || !canProceed} className={btnCls}>
                  {busy ? "確認中..." : "申請を完了する"}
                </button>
                <BackLink onClick={back} disabled={busy} />
              </>
            )}

            {step === "address" && reg && (
              <>
                <div className="pt-2 pb-1 space-y-7">
                  <div className="w-2/5">
                    <FloatingLineField
                      label="郵便番号"
                      value={reg.postalCode}
                      onChange={handlePostal}
                      inputMode="numeric"
                      autoComplete="postal-code"
                    />
                  </div>
                  {(postalBusy || postalNote) && (
                    <p className="!mt-2 text-xs text-slate-400">{postalBusy ? "住所を検索中..." : postalNote}</p>
                  )}
                  <FloatingLineField
                    label="住所"
                    value={reg.address}
                    onChange={(v) => setRegField("address", v)}
                    autoComplete="street-address"
                  />
                  <FloatingLineField
                    label="建物名・部屋番号（任意）"
                    value={building}
                    onChange={setBuilding}
                    autoComplete="address-line2"
                  />
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    checked={addressSame}
                    onChange={(e) => setAddressSame(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900"
                  />
                  <span className="text-sm text-slate-600">運転免許証に記載の住所と同じです</span>
                </label>
                {!addressSame && (
                  <p className="text-xs text-slate-500">
                    引越し等で免許証と異なる場合は、現住所を入力してください。
                  </p>
                )}
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button onClick={nextKyc} disabled={busy || !canProceed} className={btnCls}>
                  {busy ? "保存中..." : "次へ"}
                </button>
              </>
            )}

            {step === "done" && (
              <div className="text-center space-y-5 py-4">
                <FontAwesomeIcon icon={faCircleCheck} className="h-14 w-14 text-emerald-500" />
                {reg?.kycVerified ? (
                  <>
                    <p className="text-base font-semibold text-slate-900">登録が承認されています</p>
                    <p className="text-sm text-slate-600">
                      {STORES_READY
                        ? "アプリをインストールしてログインしてください。"
                        : "アプリの公開まで少しお待ちください。始め方は運営からご案内します。"}
                    </p>
                  </>
                ) : resumed ? (
                  // 申請済みの人が同じ端末で再訪したケース（URL 再訪・リロード）。
                  <>
                    <div className="space-y-1.5">
                      <p className="text-base font-semibold text-slate-900">アカウント開設の手続き中です</p>
                      <p className="text-sm text-slate-600">申請は受け付け済みです。運営が内容を確認しています。</p>
                    </div>
                    <p className="text-sm text-slate-600">
                      {STORES_READY ? "審査の結果はアプリでお知らせします。" : "審査の結果は運営からご連絡します。"}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <p className="text-base font-semibold text-slate-900">申請が完了しました</p>
                      <p className="text-sm text-slate-600">運営が入力内容と写真を確認しています。</p>
                    </div>
                    <p className="text-sm text-slate-600">
                      {STORES_READY ? (
                        <>
                          続けてアプリをインストールしてください。
                          <br />
                          審査の結果はアプリでお知らせします。
                        </>
                      ) : (
                        <>
                          アプリは近日公開予定です。
                          <br />
                          審査の結果は運営からご連絡します。
                        </>
                      )}
                    </p>
                  </>
                )}
                {passkeyDeferred && <p className="text-sm text-slate-600">ログインにはSMSを使います。Passkeyはマイページで登録できます。</p>}
                <div className="flex gap-3">
                  <StoreButton icon={faApple} label="App Store" url={APP_STORE_URL} />
                  <StoreButton icon={faGooglePlay} label="Google Play" url={PLAY_STORE_URL} />
                </div>
              </div>
            )}

            {["name", "phone", "otp"].includes(step) && (
              <BackLink onClick={back} disabled={busy} />
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 下線のみ＋フローティングラベルの入力欄（氏名・フリガナ用）。
// ラベルは placeholder 位置に置き、フォーカスまたは入力済みで左上に小さく移動する。
// transform（カナ変換等）は IME の変換中には適用しない — 変換中の value 書き換えは
// composition を壊して入力できなくなるため、確定時（onCompositionEnd）にだけかける。
// onKanaComposed: IME の変換前の読み（ひらがな）を拾ってカタカナで通知する（autokana）。
//   compositionupdate のうち「ひらがなのみ」の最新スナップショットを保持し、確定時に渡す。
function FloatingLineField({
  label,
  value,
  onChange,
  transform,
  type = "text",
  inputMode,
  autoComplete,
  autoFocus,
  onKanaComposed,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  transform?: (v: string) => string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  autoFocus?: boolean;
  onKanaComposed?: (katakana: string) => void;
}) {
  const composing = useRef(false);
  const pendingKana = useRef("");
  return (
    <div className="relative w-full min-w-0">
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(!composing.current && transform ? transform(raw) : raw);
        }}
        onCompositionStart={() => {
          composing.current = true;
          pendingKana.current = "";
        }}
        onCompositionUpdate={(e) => {
          if (/^[ぁ-ゖー\s]+$/.test(e.data ?? "")) pendingKana.current = e.data ?? "";
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          if (transform) onChange(transform(e.currentTarget.value));
          if (onKanaComposed && pendingKana.current) {
            onKanaComposed(toKatakana(pendingKana.current));
            pendingKana.current = "";
          }
        }}
        placeholder=" "
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className="peer w-full min-w-0 pt-6 pb-2 px-1 bg-transparent border-0 border-b-2 border-slate-200 rounded-none focus:border-slate-900 focus:outline-none transition-colors"
      />
      <label className="pointer-events-none absolute left-1 top-6 text-slate-400 transition-all duration-150 peer-focus:top-0.5 peer-focus:text-xs peer-focus:text-slate-500 peer-[:not(:placeholder-shown)]:top-0.5 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:text-slate-500">
        {label}
      </label>
    </div>
  );
}

// SMS認証コードの6桁入力。
function OtpSlots({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  const activeIndex = Math.min(value.length, 5);
  return (
    <div className="relative py-2">
      <div className="flex justify-center gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className={`w-10 border-b-2 pb-1 text-center font-mono text-2xl text-slate-900 transition-colors ${
              value[i] ? "border-slate-900" : focused && i === activeIndex ? "border-slate-500" : "border-slate-200"
            }`}
          >
            {value[i] ?? " "}
          </div>
        ))}
      </div>
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          onChange((composing.current ? raw : toHalfWidthDigits(raw)).slice(0, 6));
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          onChange(toHalfWidthDigits(e.currentTarget.value).slice(0, 6));
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="one-time-code"
        className="absolute inset-0 h-full w-full opacity-0"
      />
    </div>
  );
}

// ストア誘導ボタン。URL 未設定（=アプリ未公開）の間は「準備中」表示にする。
function StoreButton({
  icon,
  label,
  url,
}: {
  icon: typeof faApple;
  label: string;
  url: string;
}) {
  const inner = (
    <>
      <FontAwesomeIcon icon={icon} className="h-5 w-5" />
      <span className="flex flex-col items-start leading-tight">
        {!url && <span className="text-[9px] opacity-70">準備中</span>}
        <span className="text-sm font-semibold">{label}</span>
      </span>
    </>
  );
  const cls =
    "flex-1 inline-flex items-center justify-center gap-2.5 rounded-lg bg-slate-900 py-3 text-white transition-colors";
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-slate-800`}>
      {inner}
    </a>
  ) : (
    <span className={`${cls} opacity-45 select-none`}>{inner}</span>
  );
}

// 「戻る」系リンク（全ステップ共通・主ボタンの下に置くテキストリンク）。
function BackLink({
  onClick,
  disabled,
  children = "戻る",
}: {
  onClick: () => void;
  disabled?: boolean;
  children?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full inline-flex items-center justify-center gap-1.5 py-1 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
    >
      <FontAwesomeIcon icon={faChevronLeft} className="h-3 w-3" />
      {children}
    </button>
  );
}

// 年・月・日の select（下線スタイル）。iOS Safari では純正ホイールピッカーで開く。
// 選択状態（途中状態含む）は親の DateParts で保持＝ステップを戻っても消えない。
// 月・年の変更で選択済みの日が月末日を超えたら日をリセット（うるう年等）。
function DateWheelField({
  parts,
  onChange,
  years,
}: {
  parts: DateParts;
  onChange: (p: DateParts) => void;
  years: number[];
}) {
  const { y, m, d } = parts;
  const wheelCls =
    "w-full min-w-0 py-2.5 px-1 bg-transparent border-0 border-b-2 border-slate-200 rounded-none focus:border-slate-900 focus:outline-none transition-colors";
  const apply = (ny: string, nm: string, nd: string) => {
    const max = daysInMonth(Number(ny || "2000"), Number(nm || "1"));
    onChange({ y: ny, m: nm, d: nd && Number(nd) > max ? "" : nd });
  };
  const maxDay = daysInMonth(Number(y || "2000"), Number(m || "1"));
  return (
    <div className="flex gap-4">
      <select
        value={y}
        onChange={(e) => apply(e.target.value, m, d)}
        className={`${wheelCls} flex-[3] ${y ? "text-slate-900" : "text-slate-400"}`}
      >
        <option value="" disabled>年</option>
        {years.map((yy) => (
          <option key={yy} value={String(yy)}>{yy}年</option>
        ))}
      </select>
      <select
        value={m}
        onChange={(e) => apply(y, e.target.value, d)}
        className={`${wheelCls} flex-[2] ${m ? "text-slate-900" : "text-slate-400"}`}
      >
        <option value="" disabled>月</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
          <option key={mm} value={String(mm)}>{mm}月</option>
        ))}
      </select>
      <select
        value={d}
        onChange={(e) => apply(y, m, e.target.value)}
        className={`${wheelCls} flex-[2] ${d ? "text-slate-900" : "text-slate-400"}`}
      >
        <option value="" disabled>日</option>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((dd) => (
          <option key={dd} value={String(dd)}>{dd}日</option>
        ))}
      </select>
    </div>
  );
}

// ============================================================
// 本番 adapter（/join が使用）。通信仕様の変更はここを触る。
// ============================================================

type JoinApiRes = {
  ok: boolean;
  organizationName: string;
  alreadyApplied?: boolean;
  token?: string;
  driver?: { id: string; name: string; role: string; companyCode?: string };
};

export const realAdapter: WizardAdapter = {
  async lookupInvite(token) {
    return apiFetch<{ organizationName: string }>(`/api/join/lookup?invite=${encodeURIComponent(token)}`);
  },
  async lookupCode(code) {
    return apiFetch<{ organizationName: string }>(`/api/join/lookup?code=${encodeURIComponent(code)}`);
  },
  async tryResume() {
    const stored = getStoredDriver();
    if (!stored || canEnterAdmin(stored)) return null;
    try {
      return await apiFetch<Reg>("/api/me/registration", undefined, { skipAuthRedirect: true });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) return null;
      throw error;
    }
  },
  async sendOtp(phone) {
    await apiFetch(
      "/api/otp/send",
      { method: "POST", body: JSON.stringify({ phone }) },
      { skipAuthRedirect: true },
    );
  },
  async join(payload) {
    const res = await apiFetch<JoinApiRes>(
      "/api/join",
      { method: "POST", body: JSON.stringify(payload) },
      { skipAuthRedirect: true },
    );
    if (!res.token || !res.driver) return { alreadyApplied: !!res.alreadyApplied, reg: null };
    setAuth(res.token, res.driver);
    const reg = await apiFetch<Reg>("/api/me/registration");
    return { alreadyApplied: !!res.alreadyApplied, reg };
  },
  registerPasskey,
  async getRegistration() {
    return apiFetch<Reg>("/api/me/registration");
  },
  async saveRegistration(fields) {
    await apiFetch("/api/me/registration", { method: "POST", body: JSON.stringify(fields) });
  },
  async uploadPhoto(kind, base64) {
    // 送信は multipart バイナリ（base64 JSON は +33% 転送）。base64 はプレビュー/OCR 用
    await uploadKycPhotoMultipart(kind, base64);
  },
};
