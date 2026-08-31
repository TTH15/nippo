import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutoSave } from "@/lib/useAutoSave";

// ============================================================
// 自動保存の回帰テスト。
// 最重要は「離脱で保存が消えない」こと（2026-08-06 に実際に起きた不具合）。
// 画面を閉じた・別ページへ移った瞬間に保留中の保存が clearTimeout されていた。
// ============================================================

/** タイマーを進めつつ、保存の promise も解決させる */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("初期値では保存しない（フォームへの流し込みを変更と誤認しない）", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoSave({ value: { name: "初期" }, onSave }));
    await advance(2000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("連続した変更を1回にまとめて保存する", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });

    rerender({ v: { name: "あい" } });
    await advance(300);
    rerender({ v: { name: "あいう" } });
    await advance(300);
    expect(onSave).not.toHaveBeenCalled(); // まだデバウンス中

    await advance(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: "あいう" }); // 最後の入力で保存される
  });

  it("★unmount で保留中の保存が取り消されず、実行される", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender, unmount } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });

    rerender({ v: { name: "変更後" } });
    await advance(200); // デバウンス完了前に画面を閉じる

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: "変更後" });
  });

  it("タブを閉じる（pagehide）ときも保留中の保存を飛ばす", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });

    rerender({ v: { name: "離脱前の入力" } });
    await advance(200);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: "離脱前の入力" });
  });

  it("flush() で即座に保存できる（閉じるボタン用）", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });

    rerender({ v: { name: "確定したい" } });
    await act(async () => {
      expect(await result.current.flush()).toBe(true);
    });

    expect(onSave).toHaveBeenCalledWith({ name: "確定したい" });
  });

  it("flush() は実行中の保存完了を待って結果を返す", async () => {
    let resolveSave: (() => void) | null = null;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const { result, rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "初期" } },
    });

    rerender({ v: { name: "保存待ち" } });
    let settled = false;
    let flushPromise: Promise<boolean> | null = null;
    await act(async () => {
      flushPromise = result.current.flush().then((value) => {
        settled = true;
        return value;
      });
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    await act(async () => {
      resolveSave?.();
      expect(await flushPromise).toBe(true);
    });
    expect(settled).toBe(true);
  });

  it("失敗後の flush() は同じ値を再送する", async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error("保存失敗"))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "初期" } },
    });

    rerender({ v: { name: "再送対象" } });
    await act(async () => {
      expect(await result.current.flush()).toBe(false);
    });
    await act(async () => {
      expect(await result.current.flush()).toBe(true);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ name: "再送対象" });
  });

  it("enabled が false の間は保存しない", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ v }) => useAutoSave({ value: v, onSave, enabled: false }),
      { initialProps: { v: { name: "あ" } } },
    );
    rerender({ v: { name: "い" } });
    await advance(2000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("同じ内容の再レンダーでは保存しない", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });
    // 参照は毎回変わるが内容は同じ
    rerender({ v: { name: "あ" } });
    await advance(2000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("保存中に来た変更は捨てず、完了後にもう一度保存する", async () => {
    let resolveFirst: (() => void) | null = null;
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const { rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });

    rerender({ v: { name: "1回目" } });
    await advance(1000);
    expect(onSave).toHaveBeenCalledTimes(1);

    // 1回目の保存が終わる前に追加入力 → デバウンス満了で run が呼ばれるが実行中
    rerender({ v: { name: "2回目" } });
    await advance(1000);
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ name: "2回目" });
  });

  it("保存に失敗したら status=error になり、flush で再送できる", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("ネットワークエラー"))
      .mockResolvedValue(undefined);

    const { result, rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });

    rerender({ v: { name: "失敗する入力" } });
    await advance(1000);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("ネットワークエラー");

    // 再入力すれば再度スケジュールされ、今度は成功する
    rerender({ v: { name: "再入力" } });
    await advance(1000);
    expect(result.current.status).toBe("saved");
    expect(onSave).toHaveBeenLastCalledWith({ name: "再入力" });
  });

  it("status は 変更→saving→saved と遷移する", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ v }) => useAutoSave({ value: v, onSave }), {
      initialProps: { v: { name: "あ" } },
    });
    expect(result.current.status).toBe("idle");

    rerender({ v: { name: "い" } });
    expect(result.current.status).toBe("saving"); // 入力直後から「保存中」を出せる
    expect(result.current.hasPending).toBe(true);

    await advance(1000);
    expect(result.current.status).toBe("saved");
    expect(result.current.hasPending).toBe(false);
  });
});

describe("useAutoSave / resetKey（編集対象の切り替え）", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("別レコードを読み込んでも、その値を変更と誤認して保存しない", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ v, k }) => useAutoSave({ value: v, onSave, resetKey: k }),
      { initialProps: { v: { name: "Aさん" }, k: "a" } },
    );
    // 別のドライバーを開く＝キーと値が同時に変わる
    rerender({ v: { name: "Bさん" }, k: "b" });
    await advance(2000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("切り替え前に保留中だった保存は、切り替え時に実行される", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ v, k }) => useAutoSave({ value: v, onSave, resetKey: k }),
      { initialProps: { v: { name: "Aさん" }, k: "a" } },
    );
    rerender({ v: { name: "Aさん編集中" }, k: "a" });
    await advance(200); // デバウンス中に別レコードへ切り替え
    rerender({ v: { name: "Bさん" }, k: "b" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: "Aさん編集中" });
  });
});

it("明示的な再試行は初期表示扱いの入力も保存し、失敗なら閉じる判定をfalseにする", async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error("lease failed")).mockResolvedValue(undefined);
  const { result } = renderHook(() => useAutoSave({ value: { amount: 38000 }, onSave }));
  let succeeded = true;
  await act(async () => { succeeded = await result.current.retry(); });
  expect(succeeded).toBe(false); expect(result.current.status).toBe("error");
  await act(async () => { succeeded = await result.current.flush(); });
  expect(succeeded).toBe(true); expect(result.current.status).toBe("saved");
  expect(onSave).toHaveBeenCalledTimes(2);
});
