/** 保存先はサーバーが認可済みの会社・本人・報告から決める。URLや正規化が必要なパスは受け付けない。 */
export function isStoredPathInScope(value: unknown, prefix: string): value is string {
  const safe = (path: string) => path.split("/").every(part =>
    part !== "." && part !== ".." && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part));
  return typeof value === "string" && safe(prefix) && safe(value) && value.startsWith(`${prefix}/`);
}
