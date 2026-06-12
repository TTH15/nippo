// ============================================================
// 諸報告フォーム検証（fields.ts）のテスト。
//   validateAnswers はサーバーの信頼境界（API直叩きでもUIを経由しない不正入力を弾く）。
//   通常の正常系に加え、「予期せぬ入力」を投げる探索的テストを重点的に行う。
// ============================================================
import { describe, it, expect } from "vitest";
import {
  validateAnswers,
  normalizeFields,
  validateKindFields,
  type ReportField,
} from "./fields";

// フィールド定義の簡易ビルダー
const field = (over: Partial<ReportField> & { id: string; type: ReportField["type"] }): ReportField => ({
  label: over.label ?? over.id,
  required: false,
  ...over,
});

// ────────────────────────────────────────────────────────────
// validateAnswers — 必須・空判定
// ────────────────────────────────────────────────────────────

describe("validateAnswers — 必須/空", () => {
  it("必須が空ならエラー", () => {
    const r = validateAnswers([field({ id: "a", type: "short_text", required: true })], {});
    expect(r.ok).toBe(false);
  });

  it("任意が空ならスキップして通過", () => {
    const r = validateAnswers([field({ id: "a", type: "short_text", required: false })], {});
    expect(r.ok).toBe(true);
  });

  it("空白のみの文字列は空とみなす", () => {
    const r = validateAnswers([field({ id: "a", type: "short_text", required: true })], { a: "   " });
    expect(r.ok).toBe(false);
  });

  it("空配列の multiselect は空とみなす", () => {
    const r = validateAnswers([field({ id: "a", type: "multiselect", required: true, options: [{ value: "x", label: "X" }] })], { a: [] });
    expect(r.ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// validateAnswers — 数値・ロール
// ────────────────────────────────────────────────────────────

describe("validateAnswers — number/role", () => {
  it("数値でない文字列はエラー", () => {
    const r = validateAnswers([field({ id: "n", type: "number", required: true })], { n: "abc" });
    expect(r.ok).toBe(false);
  });

  it("min/max の範囲外はエラー", () => {
    const fields = [field({ id: "n", type: "number", min: 10, max: 20 })];
    expect(validateAnswers(fields, { n: 9 }).ok).toBe(false);
    expect(validateAnswers(fields, { n: 21 }).ok).toBe(false);
    expect(validateAnswers(fields, { n: 15 }).ok).toBe(true);
  });

  it("odometer ロールは0以上の整数のみ", () => {
    const fields = [field({ id: "o", type: "number", role: "odometer" })];
    expect(validateAnswers(fields, { o: -1 }).ok).toBe(false);
    expect(validateAnswers(fields, { o: 1.5 }).ok).toBe(false);
    expect(validateAnswers(fields, { o: 0 }).ok).toBe(true);
    expect(validateAnswers(fields, { o: 12345 }).ok).toBe(true);
  });

  it("amount ロールは1以上の整数のみ（0はエラー）", () => {
    const fields = [field({ id: "a", type: "number", role: "amount" })];
    expect(validateAnswers(fields, { a: 0 }).ok).toBe(false);
    expect(validateAnswers(fields, { a: 100 }).ok).toBe(true);
  });

  it("【探索】数値文字列 \"123\" は許容される", () => {
    const r = validateAnswers([field({ id: "n", type: "number" })], { n: "123" });
    expect(r.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// validateAnswers — 探索的: あり得ない日付・時刻
//   <input type=date/time> はUIで弾くが、API直叩きでは生文字列が来る。
//   ここはサーバ信頼境界なので、形式だけでなく実在性も検証すべき。
// ────────────────────────────────────────────────────────────

describe("validateAnswers — 不正な日付の受理（探索的）", () => {
  const dateField = [field({ id: "d", type: "date", required: true })];

  it("正常な日付は通る", () => {
    expect(validateAnswers(dateField, { d: "2026-06-12" }).ok).toBe(true);
    expect(validateAnswers(dateField, { d: "2024-02-29" }).ok).toBe(true); // 閏年
  });

  it("13月や45日など存在しない日付は弾く", () => {
    expect(validateAnswers(dateField, { d: "2026-13-45" }).ok).toBe(false);
    expect(validateAnswers(dateField, { d: "2026-00-10" }).ok).toBe(false);
    expect(validateAnswers(dateField, { d: "2026-06-00" }).ok).toBe(false);
  });

  it("2月30日・非閏年の2月29日は弾く", () => {
    expect(validateAnswers(dateField, { d: "2026-02-30" }).ok).toBe(false);
    expect(validateAnswers(dateField, { d: "2025-02-29" }).ok).toBe(false); // 2025は非閏年
  });

  it("形式が壊れた文字列は弾く", () => {
    expect(validateAnswers(dateField, { d: "2026/06/12" }).ok).toBe(false);
    expect(validateAnswers(dateField, { d: "garbage" }).ok).toBe(false);
  });
});

describe("validateAnswers — 不正な時刻の受理（探索的）", () => {
  const timeField = [field({ id: "t", type: "time", required: true })];

  it("正常な時刻は通る", () => {
    expect(validateAnswers(timeField, { t: "09:30" }).ok).toBe(true);
    expect(validateAnswers(timeField, { t: "23:59" }).ok).toBe(true);
    expect(validateAnswers(timeField, { t: "00:00" }).ok).toBe(true);
  });

  it("25時や99分など存在しない時刻は弾く", () => {
    expect(validateAnswers(timeField, { t: "25:99" }).ok).toBe(false);
    expect(validateAnswers(timeField, { t: "24:00" }).ok).toBe(false); // 24:00は不正（00:00〜23:59）
    expect(validateAnswers(timeField, { t: "12:60" }).ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// validateAnswers — select / multiselect
// ────────────────────────────────────────────────────────────

describe("validateAnswers — select/multiselect", () => {
  const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

  it("選択肢にない値はエラー", () => {
    expect(validateAnswers([field({ id: "s", type: "select", options: opts })], { s: "z" }).ok).toBe(false);
  });

  it("multiselect は全要素が選択肢に含まれる必要がある", () => {
    const f = [field({ id: "m", type: "multiselect", options: opts })];
    expect(validateAnswers(f, { m: ["a", "z"] }).ok).toBe(false);
    expect(validateAnswers(f, { m: ["a", "b"] }).ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// normalizeFields — jsonb 正規化（不正データの除去）
// ────────────────────────────────────────────────────────────

describe("normalizeFields", () => {
  it("配列でない入力は空配列", () => {
    expect(normalizeFields(null)).toEqual([]);
    expect(normalizeFields("x")).toEqual([]);
  });

  it("未知のtypeは除去される", () => {
    const out = normalizeFields([{ id: "a", type: "unknown_type", label: "X" }]);
    expect(out).toEqual([]);
  });

  it("id欠落は f_{index} で採番", () => {
    const out = normalizeFields([{ type: "short_text", label: "X" }]);
    expect(out[0].id).toBe("f_0");
  });

  it("role は odometer/amount 以外は none に正規化", () => {
    const out = normalizeFields([{ id: "a", type: "number", label: "X", role: "weird" }]);
    expect(out[0].role).toBe("none");
  });
});

// ────────────────────────────────────────────────────────────
// validateKindFields — ビルダー保存時の整合性
// ────────────────────────────────────────────────────────────

describe("validateKindFields", () => {
  it("ラベル空はエラー", () => {
    const r = validateKindFields([field({ id: "a", type: "short_text", label: "" })], "none", "none");
    expect(r.ok).toBe(false);
  });

  it("ID重複はエラー", () => {
    const r = validateKindFields(
      [field({ id: "x", type: "short_text", label: "A" }), field({ id: "x", type: "short_text", label: "B" })],
      "none",
      "none",
    );
    expect(r.ok).toBe(false);
  });

  it("経費連携には必須の金額フィールドが要る", () => {
    const ng = validateKindFields([field({ id: "a", type: "number", label: "金額", role: "amount", required: false })], "none", "expense");
    expect(ng.ok).toBe(false);
    const ok = validateKindFields([field({ id: "a", type: "number", label: "金額", role: "amount", required: true })], "none", "expense");
    expect(ok.ok).toBe(true);
  });
});
