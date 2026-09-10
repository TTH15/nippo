import { after } from "next/server";

/**
 * レスポンスを返したあとの後片付けを登録する。
 *
 * `after()` はリクエストの文脈が無いところ（単体テストなど）で呼ぶと投げるため、
 * そのまま使うと**本筋の保存まで 500 になる**（2026-09-10 に実際に踏んだ）。
 * ここで受け止めて、後片付けが登録できなくても保存の成否は変えない。
 */
export function afterSafely(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // リクエストの外。後片付けは行わない
  }
}
