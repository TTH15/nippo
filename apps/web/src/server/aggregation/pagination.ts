const PAGE_SIZE = 1000;

/**
 * Supabase/PostgREST は `db-max-rows`（既定1000件）を超える行数を、
 * クライアント側の `.limit()` 指定に関わらず黙って切り詰める。
 * `.range()` でページングして全件を取得する。
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
