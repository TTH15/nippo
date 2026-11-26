import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PostSubmitView, ReportSubmitWaitView } from "./PostSubmitView";

vi.mock("@/lib/components/CountUp", () => ({
  CountUp: ({ value, prefix }: { value: number; prefix?: string }) => <span>{prefix}{value.toLocaleString("ja-JP")}</span>,
}));

it("報酬の見込み・控除前・1日分のリースと見込みに含めた追加件数を分けて表示する", () => {
  render(<PostSubmitView onClose={() => {}} data={{ blocks: [{
    id: "reward", type: "today_reward", todayReward: 12_000,
    breakdown: { beforeLease: 14_000, dailyLease: 2_000, monthlyLease: false, includedPendingCourseCount: 1 },
  }] }} />);
  for (const text of ["¥12,000", "リース控除前（税込）", "14,000円", "日額リース（1日分）", "−2,000円", "承認待ちの追加コース1件を含みます。"])
    expect(screen.getByText(text)).toBeVisible();
  expect(screen.queryByText(/翌朝3時に確定/)).not.toBeInTheDocument();
});

it("月額契約には日額を差し引かず、承認待ち0件を未反映として表示しない", () => {
  render(<PostSubmitView onClose={() => {}} data={{ blocks: [{
    id: "reward", type: "today_reward", todayReward: 14_000,
    breakdown: { beforeLease: 14_000, dailyLease: 0, monthlyLease: true, includedPendingCourseCount: 0 },
  }] }} />);
  expect(screen.getByText("月額リースは月の報酬から差し引きます。")).toBeVisible();
  expect(screen.getByText("0円")).toBeVisible();
  expect(screen.queryByText(/承認待ちの追加コース/)).not.toBeInTheDocument();
});

it("従来の応答に内訳がない場合も金額を表示する", () => {
  render(<PostSubmitView onClose={() => {}} data={{ blocks: [{ id: "reward", type: "today_reward", todayReward: 0 }] }} />);
  expect(screen.getByText("¥0")).toBeVisible();
  expect(screen.queryByText(/リース控除前/)).not.toBeInTheDocument();
});

it("待機は送信中の1行と連続した1本のバーだけで、保存後は同じバーの長さだけ変わる", () => {
  const { rerender } = render(<ReportSubmitWaitView phase="submit" />);
  const bar = screen.getByRole("progressbar", { name: "日報の処理状況" });
  const text = screen.getByRole("status");
  const fill = bar.firstElementChild;
  expect(bar.children).toHaveLength(1);
  expect(bar).not.toHaveAttribute("aria-valuenow");
  expect(text).toHaveTextContent(/^送信しています$/);
  expect(fill).toHaveStyle("transform: scaleX(0.25)");
  expect(bar.parentElement?.textContent).toBe("送信しています");
  rerender(<ReportSubmitWaitView phase="reward" />);
  expect(screen.getByRole("progressbar", { name: "日報の処理状況" })).toBe(bar);
  expect(screen.getByRole("status")).toBe(text);
  expect(bar.firstElementChild).toBe(fill);
  expect(fill).toHaveStyle("transform: scaleX(0.75)");
  expect(bar.parentElement?.textContent).toBe("送信しています");
});

it("送信済みの結果に完了を明示しつつ、運営文言・報酬非表示とブロック順を保つ", () => {
  render(<PostSubmitView confirmed onClose={vi.fn()} data={{ todayReward: 25_000, blocks: [
    { id: "first", type: "greeting", title: "最初の案内", message: "運営からのメッセージ" },
    { id: "second", type: "greeting", title: "次の案内", message: "" },
  ] }} />);
  expect(screen.getByRole("heading", { name: "日報の送信が完了しました！" })).toBeVisible();
  expect(screen.getByText("最初の案内")).toBeVisible();
  expect(screen.getByText("運営からのメッセージ")).toBeVisible();
  expect(screen.queryByText("¥25,000")).not.toBeInTheDocument();
  expect(screen.getAllByRole("heading").map((heading) => heading.textContent?.trim())).toEqual(["日報の送信が完了しました！", "次の案内"]);
});


it("取得済み実額を読み上げ可能にし、アニメーション中の表示額は読み上げない", () => {
  render(<PostSubmitView onClose={vi.fn()} data={{ blocks: [{ id: "reward", type: "today_reward", todayReward: 12_000 }] }} />);
  expect(screen.getByText("12,000円").closest("[aria-hidden]")).toBeNull();
  expect(screen.getByText("¥12,000").closest("[aria-hidden=true]")).not.toBeNull();
  expect(screen.getByText("¥12,000").closest(".psv-reveal")).not.toBeNull();
});
