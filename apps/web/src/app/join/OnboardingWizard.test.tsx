import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), setAuth: vi.fn(), getStoredDriver: () => null }));
vi.mock("@/lib/webauthnHost", () => ({ useIsWebAuthnHost: () => true }));
vi.mock("@/lib/ocr/licenseExpiryOcr", () => ({ prefetchLicenseOcr: vi.fn(), ocrLicenseExpiryFromBase64: vi.fn() }));
import { OnboardingWizard, type Reg, type WizardAdapter } from "./OnboardingWizard";

const registration = (fields: Partial<Reg> = {}): Reg => ({
  name: "見本 太郎", dob: "1995-04-02", licenseExpiry: "", hasLicensePhoto: false,
  hasFacePhoto: false, postalCode: "", address: "", bankName: "", bankNo: "", bankHolder: "",
  complete: false, kycVerified: false, hasPasskey: false, ...fields,
});
const adapterFor = (reg: Reg): WizardAdapter => ({
  lookupInvite: vi.fn(), lookupCode: vi.fn(), tryResume: vi.fn().mockResolvedValue(reg), sendOtp: vi.fn(),
  join: vi.fn(), registerPasskey: vi.fn(), getRegistration: vi.fn().mockResolvedValue(reg),
  saveRegistration: vi.fn(), uploadPhoto: vi.fn(),
});
afterEach(cleanup);

describe("登録再開時のログイン設定", () => {
  it("参加コード入口から既存アカウントのログインへ戻れる", async () => {
    const adapter = adapterFor(registration());
    vi.mocked(adapter.tryResume).mockResolvedValue(null);
    render(<OnboardingWizard adapter={adapter} persistDraft={false} />);
    expect(await screen.findByText("運営から受け取った参加コードを入力してください。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログインへ" })).toHaveAttribute("href", "/login");
  });
  it("途中再開でも未登録ならPasskey設定を先に出す", async () => {
    render(<OnboardingWizard adapter={adapterFor(registration())} persistDraft={false} />);
    expect(await screen.findByRole("button", { name: "設定する" })).toBeEnabled();
    expect(screen.queryByText("郵便番号")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "設定する" }));
    fireEvent.click(await screen.findByRole("button", { name: "次へ" }));
    expect(await screen.findByText("郵便番号")).toBeInTheDocument();
  });
  it("登録済みならPasskeyを再要求せずKYCの続きへ進む", async () => {
    render(<OnboardingWizard adapter={adapterFor(registration({ hasPasskey: true }))} persistDraft={false} />);
    expect(await screen.findByText("郵便番号")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "設定する" })).toBeNull();
  });
  it("招待経由の申請はPasskey未登録のままKYCへ進めない", async () => {
    const adapter = adapterFor(registration({ passkeyRequired: true }));
    vi.mocked(adapter.registerPasskey).mockRejectedValue(new Error("cancelled"));
    render(<OnboardingWizard adapter={adapter} persistDraft={false} />);
    expect(await screen.findByText("招待登録を続けるには設定が必要です。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この端末では設定できない" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "設定する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("登録が完了しませんでした");
    expect(screen.queryByText("郵便番号")).toBeNull();
  });
  it("申請完了後にSMSを選んでもKYCをやり直させない", async () => {
    render(<OnboardingWizard adapter={adapterFor(registration({ complete: true }))} persistDraft={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "この端末では設定できない" }));
    fireEvent.click(await screen.findByRole("button", { name: "SMSでログインする方法で進む" }));
    expect(await screen.findByText("アカウント開設の手続き中です")).toBeInTheDocument();
    expect(screen.getByText(/ログインにはSMSを使います/)).toBeInTheDocument();
    expect(screen.queryByText("郵便番号")).toBeNull();
  });
  it("初回の状態取得失敗から入力内容を誤認せず再試行できる", async () => {
    const adapter = adapterFor(registration());
    vi.mocked(adapter.tryResume).mockRejectedValueOnce(new Error("接続できませんでした"));
    render(<OnboardingWizard adapter={adapter} persistDraft={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("接続できませんでした");
    fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
    expect(await screen.findByRole("button", { name: "設定する" })).toBeEnabled();
  });
});
