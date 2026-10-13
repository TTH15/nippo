"use client";

import { useEffect, useState } from "react";

const storageKey = "nippo_phone_resend_after";
const cooldownMs = 60_000;
const remaining = (deadline: number) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
function readDeadline() {
  try {
    const value = Number(sessionStorage.getItem(storageKey));
    return Number.isFinite(value) && value > Date.now() && value <= Date.now() + cooldownMs ? value : 0;
  } catch { return 0; }
}

/** 送信成功から60秒。再読込でも同じタブの待機時間を保つ。 */
export function useSmsResendCooldown() {
  const [deadline, setDeadline] = useState(readDeadline);
  const [seconds, setSeconds] = useState(() => remaining(deadline));
  useEffect(() => {
    setSeconds(remaining(deadline));
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const next = remaining(deadline); setSeconds(next);
      if (next === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  function start() {
    const next = Date.now() + cooldownMs;
    setDeadline(next); setSeconds(60);
    try { sessionStorage.setItem(storageKey, String(next)); } catch { /* 保存不可でも画面内の待機は維持する */ }
  }
  return { seconds, start };
}
