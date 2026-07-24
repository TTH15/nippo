"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

// ============================================================
// 本登録（KYC）ウィザード（web 一本化・確定フロー §2-1a）。
// 仮承認済みドライバーが電話OTP等でログイン後にここで本登録を完了する。
// ステップ: ①免許証 正面＋有効期限 ②顔写真 ③住所 ④口座。裏面なし・OCRなし（期限手入力）。
// 写真は端末側で canvas 縮小→JPEG 再エンコードしてから送信（8MB上限・JPEG/PNG 制約に適合）。
// API は mobile KycWizard と共有: GET/POST /api/me/registration・POST /api/me/registration/photo。
// ============================================================

type Reg = {
  name: string;
  dob: string;
  licenseExpiry: string;
  hasLicensePhoto: boolean;
  hasFacePhoto: boolean;
  postalCode: string;
  address: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
  complete: boolean;
  kycVerified: boolean;
};

const STEP_KEYS = ["license", "face", "address", "bank"] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STEP_LABEL: Record<StepKey, string> = {
  license: "免許",
  face: "顔写真",
  address: "住所",
  bank: "口座",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// サーバの complete 条件（値が入っているか）に揃える。canNext の形式チェックとは別基準。
const isStepDone = (k: StepKey, r: Reg): boolean => {
  switch (k) {
    case "license":
      return r.hasLicensePhoto && !!r.licenseExpiry;
    case "face":
      return r.hasFacePhoto;
    case "address":
      return !!r.postalCode && !!r.address;
    case "bank":
      return !!r.bankName && !!r.bankNo && !!r.bankHolder;
  }
};

// 数字だけ入力させ YYYY-MM-DD へ自動整形（mobile と同挙動）。
const formatDateInput = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  let out = d.slice(0, 4);
  if (d.length > 4) out += "-" + d.slice(4, 6);
  if (d.length > 6) out += "-" + d.slice(6, 8);
  return out;
};

// 画像を長辺 maxDim 以内へ縮小し JPEG(base64・prefix なし) へ再エンコード。
// 8MB 上限とマジックバイト検証（実体 JPEG）に確実に収めるための web 側前処理。
async function fileToJpegBase64(file: File, maxDim = 1600, quality = 0.72): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("画像を読み込めませんでした"));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像処理に失敗しました");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return dataUrl.split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function RegisterPage() {
  const [reg, setReg] = useState<Reg | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState<{ license?: string; face?: string }>({});

  useEffect(() => {
    apiFetch<Reg>("/api/me/registration")
      .then((r) => {
        setReg(r);
        if (r.complete) return; // 完了済みは下の待機/案内表示へ
        const first = STEP_KEYS.findIndex((k) => !isStepDone(k, r));
        setStep(first < 0 ? STEP_KEYS.length - 1 : first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, []);

  const inputCls =
    "w-full py-2.5 px-4 border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none transition-colors";
  const btnCls =
    "flex-1 py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  if (!reg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
        <div className="text-sm text-slate-500">
          {error ? <span className="text-red-600">{error}</span> : "読み込み中..."}
        </div>
      </div>
    );
  }

  // 完了後の状態表示（本人確認待ち / 承認済み）。
  if (reg.complete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border border-slate-200 p-6 text-center space-y-3">
          {reg.kycVerified ? (
            <>
              <p className="text-base font-semibold text-slate-900">本登録が承認されました</p>
              <p className="text-sm text-slate-600">
                アプリをインストールして、そのままログインすると業務を開始できます。
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-slate-900">本登録を受け付けました</p>
              <p className="text-sm text-slate-600">
                運営による本人確認（免許・顔写真の確認）をお待ちください。
                <br />
                確認が完了すると業務を開始できます。
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const key = STEP_KEYS[step];
  const set = (k: keyof Reg, v: string) => setReg((r) => (r ? { ...r, [k]: v } : r));

  const uploadPhoto = async (kind: "license" | "face", file: File) => {
    setError("");
    setBusy(true);
    try {
      const base64 = await fileToJpegBase64(file);
      if (!base64) throw new Error("画像の変換に失敗しました");
      await apiFetch("/api/me/registration/photo", {
        method: "POST",
        body: JSON.stringify({ kind, base64, mime: "image/jpeg" }),
      });
      setReg((r) => (r ? { ...r, [kind === "license" ? "hasLicensePhoto" : "hasFacePhoto"]: true } : r));
      setPreviews((p) => ({ ...p, [kind]: `data:image/jpeg;base64,${base64}` }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const canNext = (() => {
    switch (key) {
      case "license":
        return reg.hasLicensePhoto && DATE_RE.test(reg.licenseExpiry);
      case "face":
        return reg.hasFacePhoto;
      case "address":
        return !!reg.postalCode.trim() && !!reg.address.trim();
      case "bank":
        return !!reg.bankName.trim() && !!reg.bankNo.trim() && !!reg.bankHolder.trim();
    }
  })();

  const next = async () => {
    setError("");
    setBusy(true);
    try {
      if (key === "license") {
        await apiFetch("/api/me/registration", {
          method: "POST",
          body: JSON.stringify({ licenseExpiry: reg.licenseExpiry, dob: reg.dob }),
        });
      } else if (key === "address") {
        await apiFetch("/api/me/registration", {
          method: "POST",
          body: JSON.stringify({ postalCode: reg.postalCode, address: reg.address }),
        });
      } else if (key === "bank") {
        await apiFetch("/api/me/registration", {
          method: "POST",
          body: JSON.stringify({ bankName: reg.bankName, bankNo: reg.bankNo, bankHolder: reg.bankHolder }),
        });
      }
      if (step < STEP_KEYS.length - 1) {
        setStep(step + 1);
      } else {
        const fresh = await apiFetch<Reg>("/api/me/registration");
        setReg(fresh);
        if (!fresh.complete) {
          const missing = STEP_KEYS.filter((k) => !isStepDone(k, fresh));
          const first = STEP_KEYS.findIndex((k) => !isStepDone(k, fresh));
          setStep(first < 0 ? 0 : first);
          setError(`未入力の項目があります（${missing.map((k) => STEP_LABEL[k]).join("・")}）`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const progress = (step + (canNext ? 1 : 0)) / STEP_KEYS.length;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="p-3 border-b border-slate-200 flex flex-col items-center gap-2">
            <img
              src="/logo/hakotora-logo_secondary_logo.svg"
              alt="ロゴ"
              className="h-12"
              style={{ maxWidth: "60%", height: "auto" }}
            />
            <h1 className="text-base font-semibold text-slate-900">本登録</h1>
            <div className="w-full">
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>
                  {step + 1} / {STEP_KEYS.length}　{STEP_LABEL[key]}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-1.5 rounded-full bg-slate-900 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {key === "license" && (
              <>
                <PhotoBox
                  title="免許証の写真（正面）"
                  done={reg.hasLicensePhoto}
                  previewUri={previews.license}
                  busy={busy}
                  onPick={(f) => uploadPhoto("license", f)}
                />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">免許の有効期限</label>
                  <input
                    inputMode="numeric"
                    value={reg.licenseExpiry}
                    onChange={(e) => set("licenseExpiry", formatDateInput(e.target.value))}
                    className={inputCls}
                    placeholder="例: 20280822（数字のみ）"
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">生年月日（任意）</label>
                  <input
                    inputMode="numeric"
                    value={reg.dob}
                    onChange={(e) => set("dob", formatDateInput(e.target.value))}
                    className={inputCls}
                    placeholder="例: 20030722（数字のみ）"
                    maxLength={10}
                  />
                </div>
              </>
            )}

            {key === "face" && (
              <PhotoBox
                title="顔写真"
                done={reg.hasFacePhoto}
                previewUri={previews.face}
                busy={busy}
                onPick={(f) => uploadPhoto("face", f)}
              />
            )}

            {key === "address" && (
              <>
                <input
                  inputMode="numeric"
                  value={reg.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                  className={inputCls}
                  placeholder="郵便番号"
                  autoFocus
                />
                <input
                  value={reg.address}
                  onChange={(e) => set("address", e.target.value)}
                  className={inputCls}
                  placeholder="住所"
                />
              </>
            )}

            {key === "bank" && (
              <>
                <input
                  value={reg.bankName}
                  onChange={(e) => set("bankName", e.target.value)}
                  className={inputCls}
                  placeholder="銀行名・支店"
                  autoFocus
                />
                <input
                  inputMode="numeric"
                  value={reg.bankNo}
                  onChange={(e) => set("bankNo", e.target.value)}
                  className={inputCls}
                  placeholder="口座番号"
                />
                <input
                  value={reg.bankHolder}
                  onChange={(e) => set("bankHolder", e.target.value)}
                  className={inputCls}
                  placeholder="口座名義（カナ）"
                />
              </>
            )}

            {error && <p className="text-sm text-red-600 text-center">{error}</p>}

            <div className="flex gap-3">
              {step > 0 && (
                <button
                  onClick={() => {
                    setError("");
                    setStep(step - 1);
                  }}
                  disabled={busy}
                  className="py-2.5 px-5 rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  戻る
                </button>
              )}
              <button onClick={next} disabled={!canNext || busy} className={btnCls}>
                {busy ? "保存中..." : step === STEP_KEYS.length - 1 ? "完了" : "次へ"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoBox({
  title,
  done,
  previewUri,
  busy,
  onPick,
}: {
  title: string;
  done: boolean;
  previewUri?: string;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={`w-full h-44 rounded-lg border flex items-center justify-center overflow-hidden ${
          done ? "border-emerald-500 bg-emerald-50" : "border-dashed border-slate-300 bg-slate-50"
        } disabled:opacity-60`}
      >
        {previewUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUri} alt="preview" className="w-full h-full object-cover" />
        ) : busy ? (
          <span className="text-sm text-slate-400">処理中...</span>
        ) : (
          <span className={`text-sm ${done ? "text-emerald-600 font-semibold" : "text-slate-400"}`}>
            {done ? "✓ 登録済み（撮り直し可）" : "タップして撮影・選択"}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
