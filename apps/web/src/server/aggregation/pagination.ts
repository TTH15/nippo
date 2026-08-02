const PAGE_SIZE = 1000;

/**
 * `.in("col", ids)` の ids 件数が多いと、UUID(36文字)の羅列でURLが
 * PostgRESTのヘッダ上限(既定16KB)を超え `Bad Request` / ヘッダオーバーフローで
 * サイレントに失敗する（Supabase公式エラーメッセージでも200件超で要注意と明示）。
 * 安全側に倒し、IN句に渡すID件数はこの値以下に分割する。
 */
export const IN_CLAUSE_BATCH_SIZE = 200;

/**
 * Supabase/PostgREST は `db-max-rows`（既定1000件）を超える行数を、
 * クライアント側の `.limit()` 指定に関わらず黙って切り詰める。
 * `.range()` でページングして全件を取得する。
 *
 * **queryFactory には必ず一意な ORDER BY を付けること**（例: `.order("report_date").order("id")`）。
 * Postgres は ORDER BY 無しの OFFSET/LIMIT で行順を保証しないため、ページ間で
 * 行の重複・欠落が起きる。1000行以下では1ページで収まり露見しないので、
 * データが増えてから静かに壊れる（2026-08-03 の未提出誤表示がこれ）。
 */
export async function fetchAllRows<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryFactory(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}
