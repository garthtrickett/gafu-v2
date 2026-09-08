import { describe, expect, test } from "bun:test";
import { bigrams, exactSignature, isNearCopy, nearSignature } from "./variation.ts";

describe("material variation signatures", () => {
  test("normalizes exact copies and rejects ineffective rewrites", () => {
    expect(exactSignature("猫です。")).toBe(exactSignature("猫です。"));
    const prior = [nearSignature("猫は静かな部屋で寝ています。", "猫")];
    expect(isNearCopy("猫は静かな部屋で寝ています!", "猫", prior)).toBe(true);
  });

  test("masks the required target before comparing situations", () => {
    const target = "なければならない";
    const prior = [nearSignature(`${target}かな。`, target)];
    expect(isNearCopy(`でも${target}。`, target, prior)).toBe(false);
    expect(bigrams(`${target}かな。`, target)).toContain("標的");
  });
});
