import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { AutoSaveTextInput } from "@/lib/components/AutoSaveTextInput";

// ============================================================
// 「blur しないまま閉じると入力が消える」問題の回帰テスト。
// シフト画面の集合場所が onBlur 保存だったため、パネルを閉じる＝アンマウントでは
// blur が発火せず保存されなかった（2026-08-06）。
// ============================================================

describe("AutoSaveTextInput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const typeInto = (text: string) => {
    fireEvent.change(screen.getByPlaceholderText("集合場所"), { target: { value: text } });
  };

  it("入力を止めると自動で保存される（blur しなくてよい）", async () => {
    const onSave = vi.fn();
    render(<AutoSaveTextInput value="" onSave={onSave} placeholder="集合場所" />);
    typeInto("京都駅前");
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith("京都駅前");
  });

  it("★blur しないままアンマウントされても保存される", async () => {
    const onSave = vi.fn();
    const { unmount } = render(
      <AutoSaveTextInput value="" onSave={onSave} placeholder="集合場所" />,
    );
    typeInto("入力したまま閉じる");
    await act(async () => {
      vi.advanceTimersByTime(100); // デバウンス完了前に閉じる
      unmount();
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith("入力したまま閉じる");
  });

  it("blur すれば待たずに確定する", async () => {
    const onSave = vi.fn();
    render(<AutoSaveTextInput value="" onSave={onSave} placeholder="集合場所" />);
    typeInto("すぐ確定");
    await act(async () => {
      fireEvent.blur(screen.getByPlaceholderText("集合場所"));
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith("すぐ確定");
  });

  it("値が変わっていなければ保存しない", async () => {
    const onSave = vi.fn();
    render(<AutoSaveTextInput value="京都駅前" onSave={onSave} placeholder="集合場所" />);
    typeInto("京都駅前 "); // 前後の空白だけの違い
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("空にしたら null を渡す（コース標準に戻す）", async () => {
    const onSave = vi.fn();
    render(<AutoSaveTextInput value="京都駅前" onSave={onSave} placeholder="集合場所" />);
    typeInto("");
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("disabled のときは保存しない", async () => {
    const onSave = vi.fn();
    render(<AutoSaveTextInput value="" onSave={onSave} disabled placeholder="集合場所" />);
    typeInto("権限なし");
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});
