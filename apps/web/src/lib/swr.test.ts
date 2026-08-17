import { describe, it, expect, vi, beforeEach } from "vitest";

// SWR の mutate はデータ引数を「渡したかどうか」を arguments.length で判定する。
//   mutate(matcher)                              → 再検証のみ（今の値を保つ）
//   mutate(matcher, undefined, { revalidate })   → data を undefined で上書きしてから再検証
//
// 後者だと購読側の data が一瞬 undefined に戻り、isInitialLoading が true に跳ねて
// 「読み込み中」が挟まる。請求書エディタでは自動保存のたびに再マウントし、
// Undo 履歴まで失われていた（2026-08-17 報告）。引数を増やさないことをここで固定する。

const mutateMock = vi.fn();
vi.mock("swr", () => ({ mutate: (...args: unknown[]) => mutateMock(...args) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

import { invalidateApi } from "./swr";

describe("invalidateApi", () => {
  beforeEach(() => mutateMock.mockClear());

  it("mutate にデータ引数を渡さない（キャッシュを undefined で潰さない）", () => {
    invalidateApi("/api/admin/invoices?");
    expect(mutateMock).toHaveBeenCalledTimes(1);
    // ★引数は matcher の1つだけ。2つ目を足した時点でキャッシュが消える
    expect(mutateMock.mock.calls[0]).toHaveLength(1);
  });

  it("接頭辞に一致するキーだけを対象にする", () => {
    invalidateApi("/api/admin/invoices?");
    const matcher = mutateMock.mock.calls[0][0] as (key: unknown) => boolean;

    expect(matcher("/api/admin/invoices?month=2026-08")).toBe(true);
    expect(matcher("/api/admin/invoices?months=1")).toBe(true);
    // 編集中の請求書そのもの（詳細キー）は巻き込まない
    expect(matcher("/api/admin/invoices/abc-123")).toBe(false);
    expect(matcher("/api/admin/courses")).toBe(false);
  });

  it("useSWRInfinite の内部キー（$inf$ 前置）にも当たる", () => {
    invalidateApi("/api/admin/invoices?");
    const matcher = mutateMock.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher('$inf$/api/admin/invoices?month=2026-08')).toBe(true);
  });

  it("文字列でないキー（配列キー等）は無視する", () => {
    invalidateApi("/api/admin/invoices?");
    const matcher = mutateMock.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher(["/api/admin/invoices?month=2026-08"])).toBe(false);
    expect(matcher(null)).toBe(false);
  });

  it("複数の接頭辞を渡せる", () => {
    invalidateApi("/api/admin/courses", "/api/admin/users");
    const matcher = mutateMock.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher("/api/admin/courses")).toBe(true);
    expect(matcher("/api/admin/users?all=1")).toBe(true);
    expect(matcher("/api/admin/vehicles")).toBe(false);
  });
});
