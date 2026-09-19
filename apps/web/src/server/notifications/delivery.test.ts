import { describe, expect, it } from "vitest";
import { isResendable, summarizeDeliveries, type DeliveryRow } from "./delivery";

const row = (over: Partial<DeliveryRow> = {}): DeliveryRow => ({
  notificationId: "n1",
  channel: "line",
  status: "sent",
  error: null,
  ...over,
});

describe("summarizeDeliveries", () => {
  it("どれか1つでも送れていれば届いた扱い", () => {
    const result = summarizeDeliveries(["n1"], [
      row({ channel: "line", status: "skipped", error: "unlinked" }),
      row({ channel: "web_push", status: "sent" }),
    ]);
    expect(result[0]).toMatchObject({ reached: true, reason: null });
  });

  it("配信ログが1行も無い通知も「届いていない」に含める", () => {
    expect(summarizeDeliveries(["n1"], [])[0]).toMatchObject({ reached: false, reason: "no_attempt" });
  });

  it("送信失敗を最優先で出す（起きてはいけないので）", () => {
    const result = summarizeDeliveries(["n1"], [
      row({ channel: "line", status: "failed", error: "timeout" }),
      row({ channel: "web_push", status: "skipped", error: "no_subscription" }),
    ]);
    expect(result[0]).toMatchObject({ reached: false, reason: "failed" });
  });

  it("未連携は端末なし・未設定より先に出す", () => {
    const result = summarizeDeliveries(["n1"], [
      row({ channel: "web_push", status: "skipped", error: "no_subscription" }),
      row({ channel: "line", status: "skipped", error: "unlinked" }),
    ]);
    expect(result[0].reason).toBe("unlinked");
  });

  it("会社で未設定だけなら not_configured", () => {
    const result = summarizeDeliveries(["n1"], [row({ channel: "line", status: "skipped", error: "not_configured" })]);
    expect(result[0].reason).toBe("not_configured");
  });

  it("通知ごとに分ける", () => {
    const result = summarizeDeliveries(["n1", "n2"], [
      row({ notificationId: "n1", status: "sent" }),
      row({ notificationId: "n2", status: "failed", error: "boom" }),
    ]);
    expect(result.map((r) => r.reached)).toEqual([true, false]);
  });

  it("チャネルごとの内訳を残す", () => {
    const result = summarizeDeliveries(["n1"], [
      row({ channel: "line", status: "skipped", error: "unlinked" }),
      row({ channel: "web_push", status: "failed", error: null }),
    ]);
    expect(result[0].channels).toHaveLength(2);
  });
});

describe("isResendable", () => {
  it("経路が無いものは再送しても届かない", () => {
    expect(isResendable("unlinked")).toBe(false);
    expect(isResendable("no_subscription")).toBe(false);
    expect(isResendable("not_configured")).toBe(false);
  });

  it("送信失敗だけ再送する", () => {
    expect(isResendable("failed")).toBe(true);
  });

  it("記録が無いものは再送しない（届いていない証拠ではないため）", () => {
    // この機能より前の通知には配信ログが無い。一括再送すると古い通知が連打される
    expect(isResendable("no_attempt")).toBe(false);
  });

  it("届いているものは対象外", () => {
    expect(isResendable(null)).toBe(false);
  });
});
