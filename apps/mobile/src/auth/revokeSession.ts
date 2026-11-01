/** サーバー側の失効が確認できるまで、再試行に必要な端末の認証情報を残す。 */
export async function revokeSession(baseUrl: string, token: string | null, send: typeof fetch = fetch) {
  if (!token) return;
  const response = await send(`${baseUrl}/api/auth/logout`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
  });
  if (!response.ok && response.status !== 401) throw new Error("ログアウトを完了できませんでした。通信を確認して、もう一度お試しください。");
}
