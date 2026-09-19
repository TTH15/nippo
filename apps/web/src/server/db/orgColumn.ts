// org_id 列を後から足す migration（174: 希望休 / 175: シフト）の移行ヘルパー。
//
// 列を足すと `check:tenant` がその表を検査対象に含めるので、書き込み経路は org_id を
// 入れるのが原則になる。ただし **migration を本番へ適用する前にコードが出てしまうと、
// その書き込み（希望休の提出・シフトの取込）がそのまま落ちる**。
// 適用順に依存しないよう、列がまだ無い環境では org_id を落として書き込み直す。
//   （vehicles の part_colors / 一時使用不可列と同じ扱い方）
// 対象の migration が全環境に入りきったら、この退避と呼び出し側の分岐は消してよい。
type DatabaseErrorLike = { code?: string | null; message?: string | null } | null | undefined;

/** org_id 列がまだ無いことだけが原因のエラーかを判定する。 */
export function isMissingOrgColumn(error: DatabaseErrorLike): boolean {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (!message.includes("org_id")) return false;
  // 42703 = Postgres の undefined_column / PGRST204 = PostgREST のスキーマキャッシュに無い
  return error.code === "42703" || error.code === "PGRST204" || message.includes("does not exist");
}

/** org_id を落とした行。列がまだ無い環境でのみ使う退避経路。元の配列は変えない。 */
export function withoutOrgId<T extends { org_id?: string | null }>(rows: T[]): Omit<T, "org_id">[] {
  return rows.map((row) => {
    const rest = { ...row };
    delete (rest as { org_id?: string | null }).org_id;
    return rest;
  });
}
