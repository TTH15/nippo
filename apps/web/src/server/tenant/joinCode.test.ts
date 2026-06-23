import { describe, it, expect } from "vitest";
import { generateJoinCode, JOIN_CODE_ALPHABET } from "./joinCode";

describe("generateJoinCode", () => {
  it("既定で6文字を返す", () => {
    expect(generateJoinCode()).toHaveLength(6);
  });

  it("length 指定が効く", () => {
    expect(generateJoinCode(8)).toHaveLength(8);
  });

  it("曖昧文字（O/0/I/1/L）を含まない英数字のみ", () => {
    const re = new RegExp(`^[${JOIN_CODE_ALPHABET}]+$`);
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toMatch(re);
      expect(code).not.toMatch(/[O0I1L]/);
    }
  });

  it("十分に多様（200回でほぼ重複しない）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateJoinCode());
    // 31^6 の空間。200 件ならまず衝突しない（数件の衝突は許容）
    expect(seen.size).toBeGreaterThan(195);
  });
});
