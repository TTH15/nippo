"use client";

import { Suspense, useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { startAuthentication } from "@simplewebauthn/browser";
import { apiFetch, setLoginSession, getStoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
import { useIsWebAuthnHost } from "@/lib/webauthnHost";
import { loginSceneTransition } from "@/lib/ui/motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCommentSms, faFingerprint } from "@fortawesome/free-solid-svg-icons";
import "./login.css";

const styles = {
  auth: "login-auth",
  back: "login-back",
  driverAuth: "login-driverAuth",
  driverHit: "login-driverHit",
  driverPhoto: "login-driverPhoto",
  driverTitle: "login-driverTitle",
  entryHit: "login-entryHit",
  error: "login-error",
  hostHint: "login-hostHint",
  loading: "login-loading",
  logo: "login-logo",
  mobile: "login-mobile",
  mobileOr: "login-mobileOr",
  mobileBody: "login-mobileBody",
  mobilePhoto: "login-mobilePhoto",
  mobileLogo: "login-mobileLogo",
  mobileTitle: "login-mobileTitle",
  operationsAuth: "login-operationsAuth",
  operationsHit: "login-operationsHit",
  operationsPhoto: "login-operationsPhoto",
  operationsTitle: "login-operationsTitle",
  passkey: "login-passkey",
  recover: "login-recover",
  scene: "login-scene",
  seam: "login-seam",
} as const;

type Entry = "driver" | "admin" | null;
type LoginResult = {
  token: string;
  adminToken?: string | null;
  driver: { id: string; name: string; role: string; companyCode?: string };
};

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canUsePasskey = useIsWebAuthnHost();
  const next = searchParams.get("next");
  const [entry, setEntry] = useState<Entry>(next === "admin" || next === "driver" ? next : null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");

  useEffect(() => {
    setEntry(next === "admin" || next === "driver" ? next : null);
  }, [next]);

  const selectEntry = (selected: Entry) => {
    if (passkeyLoading) return;
    setEntry(selected);
    setPasskeyError("");
    router.replace(selected ? `/login?next=${selected}` : "/login");
  };

  const handlePasskeyLogin = async (target: "driver" | "admin") => {
    setPasskeyLoading(true);
    setPasskeyError("");
    try {
      const { options, challengeToken } = await apiFetch<{
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        challengeToken: string;
      }>("/api/auth/webauthn/login/options", { method: "POST" }, { skipAuthRedirect: true });
      const authResponse = await startAuthentication({ optionsJSON: options });
      const res = await apiFetch<LoginResult>(
        "/api/auth/webauthn/login/verify",
        { method: "POST", body: JSON.stringify({ response: authResponse, challengeToken }) },
        { skipAuthRedirect: true },
      );

      setLoginSession(res.token, res.driver, res.adminToken);
      if (target === "admin" && (!res.adminToken || !canEnterAdmin(getStoredDriver() ?? res.driver))) {
        setPasskeyError("運営画面の権限がありません");
        return;
      }
      router.push(target === "admin" ? "/admin" : "/submit");
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setPasskeyError(err.message || "パスキーでログインできませんでした");
      }
      console.error("Passkey login error:", err);
    } finally {
      setPasskeyLoading(false);
    }
  };

  const motionStyle = {
    "--login-duration": `${loginSceneTransition.duration * 1000}ms`,
    "--login-ease": `cubic-bezier(${loginSceneTransition.ease.join(",")})`,
  } as CSSProperties;

  const authControls = (target: "driver" | "admin", mobile = false) => <>
    {canUsePasskey ? <button type="button" className={styles.passkey} onClick={() => handlePasskeyLogin(target)} disabled={passkeyLoading}>
      <FontAwesomeIcon icon={faFingerprint} aria-hidden="true" />
      {passkeyLoading ? "確認中..." : "パスキーでログイン"}
    </button> : <p className={styles.hostHint}>パスキーはSafariかChromeでお使いください。</p>}
    {passkeyError && <p role="alert" className={styles.error}>{passkeyError}</p>}
    {mobile && target === "driver" && <div className={styles.mobileOr}>または</div>}
    <Link className={styles.recover} href={`/login/recover?next=${target}`}>
      {target === "admin" ? "パスキーを設定・復旧する" : <><FontAwesomeIcon icon={faCommentSms} aria-hidden="true" /> 電話番号でログイン</>}
    </Link>
  </>;

  return (
    <>
    <main className={styles.scene} data-entry={entry ?? "none"} style={motionStyle}>
      <div className={styles.driverPhoto} style={{ backgroundImage: "linear-gradient(180deg, rgb(240 244 249 / .36) 0%, rgb(240 244 249 / .02) 75%), url(\"/login/driver-keivan.webp\")" }} aria-hidden="true" />
      <div className={styles.seam} aria-hidden="true" />
      <div className={styles.operationsPhoto} style={{ backgroundImage: "linear-gradient(90deg, rgb(4 13 30 / .36), rgb(4 13 30 / .11)), url(\"/login/operations-depot.webp\")" }} aria-hidden="true" />

      <img src="/logo/hakotora-logo_secondary_logo.svg" alt="ハコ虎" className={styles.logo} />

      <button type="button" className={`${styles.entryHit} ${styles.driverHit}`}
        onClick={() => selectEntry("driver")} aria-label="ドライバー画面を選ぶ" aria-pressed={entry === "driver"}>
        <span className={styles.driverTitle}>ドライバー</span>
      </button>
      <button type="button" className={`${styles.entryHit} ${styles.operationsHit}`}
        onClick={() => selectEntry("admin")} aria-label="運営画面を選ぶ" aria-pressed={entry === "admin"}>
        <span className={styles.operationsTitle}>運営</span>
      </button>

      {entry && <section className={`${styles.auth} ${entry === "admin" ? styles.operationsAuth : styles.driverAuth}`}
        aria-label={entry === "admin" ? "運営画面のログイン" : "ドライバー画面のログイン"}>
        <button type="button" className={styles.back} onClick={() => selectEntry(null)} disabled={passkeyLoading}>
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" /> 選び直す
        </button>
        {authControls(entry)}
      </section>}
    </main>
    <main className={styles.mobile} data-entry={next === "admin" ? "admin" : "driver"}>
      <div className={styles.mobilePhoto} style={{ backgroundImage: next === "admin"
        ? "linear-gradient(180deg, rgb(4 13 30 / .06) 0%, rgb(4 13 30 / .24) 58%, #edf1f6 100%), url('/login/operations-depot.webp')"
        : "linear-gradient(180deg, rgb(240 244 249 / .18) 0%, rgb(240 244 249 / .08) 70%, #edf1f6 100%), url('/login/driver-keivan.webp')" }} aria-hidden="true" />
      <img src={next === "admin" ? "/login/hakotora-logo-cropped.svg" : "/logo/hakotora-logo_secondary_logo.svg"} alt="ハコ虎" className={styles.mobileLogo} />
      <section className={`${styles.mobileBody} ${next === "admin" ? styles.operationsAuth : styles.driverAuth}`}
        aria-label={next === "admin" ? "運営画面のログイン" : "ドライバー画面のログイン"}>
        {next === "admin" && <h1 className={styles.mobileTitle}>運営</h1>}
        {authControls(next === "admin" ? "admin" : "driver", true)}
      </section>
    </main>
    </>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className={styles.loading} />}><LoginPageContent /></Suspense>;
}
