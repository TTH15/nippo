import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParkingLongPress } from "./useParkingLongPress";

describe("parking pin gesture", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a stationary hold places one pin at the original point", () => {
    const place = vi.fn();
    const { result } = renderHook(() => useParkingLongPress(place));
    result.current.start(1, 17, 38);
    result.current.move(1, 20, 40);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.finish()).toBe(true);
    expect(place).toHaveBeenCalledExactlyOnceWith(17, 38);
  });

  it("handles tap, pan, second pointer, and unmount without selecting", () => {
    const place = vi.fn();
    const { result, unmount } = renderHook(() => useParkingLongPress(place));
    result.current.start(1, 20, 40);
    expect(result.current.finish()).toBe(false);
    result.current.start(1, 20, 40);
    result.current.move(1, 35, 42);
    act(() => vi.advanceTimersByTime(600));
    result.current.start(1, 20, 40);
    result.current.move(2, 20, 40);
    act(() => vi.advanceTimersByTime(600));
    result.current.start(1, 20, 40);
    unmount();
    act(() => vi.advanceTimersByTime(600));
    expect(place).not.toHaveBeenCalled();
  });
});
