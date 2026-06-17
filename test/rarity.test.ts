// レア度クォータ配分のテスト（ADR-0009、旧 ADR-0008 を Supersede）。
// 決定論・構成比一致・端数処理を検証する。
import { describe, it, expect } from "vitest";
import { allocateRarities, RARITY_DISTRIBUTION } from "../src/lib/rarity";

function counts(rarities: number[]): Map<number, number> {
  const m = new Map<number, number>([
    [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
  ]);
  for (const r of rarities) m.set(r, (m.get(r) ?? 0) + 1);
  return m;
}

describe("RARITY_DISTRIBUTION", () => {
  it("重みは合計 1.0", () => {
    const sum = RARITY_DISTRIBUTION.reduce((a, t) => a + t.weight, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe("allocateRarities", () => {
  it("常に length === total で、各要素は 1..5 の整数", () => {
    for (const total of [0, 1, 7, 16, 100, 1234]) {
      const out = allocateRarities(total);
      expect(out).toHaveLength(total);
      for (const r of out) {
        expect(Number.isInteger(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(5);
      }
    }
  });

  it("決定論的: 同じ total は常に同じ配分", () => {
    const a = allocateRarities(537);
    for (let i = 0; i < 20; i++) {
      expect(allocateRarities(537)).toEqual(a);
    }
  });

  it("レア度昇順に並ぶ（★1 が先頭・★5 が末尾）", () => {
    const out = allocateRarities(100);
    const sorted = [...out].sort((x, y) => x - y);
    expect(out).toEqual(sorted);
  });

  it("負数・非整数は例外", () => {
    expect(() => allocateRarities(-1)).toThrow();
    expect(() => allocateRarities(3.5)).toThrow();
  });

  it("大量プールで配分が構成比に厳密に一致する（最大剰余法）", () => {
    const N = 10000;
    const c = counts(allocateRarities(N));
    // 10000 では端数なく整数化される: 5000/3000/1400/500/100
    expect(c.get(1)).toBe(5000);
    expect(c.get(2)).toBe(3000);
    expect(c.get(3)).toBe(1400);
    expect(c.get(4)).toBe(500);
    expect(c.get(5)).toBe(100);
    // 合計は N。
    expect([...c.values()].reduce((a, b) => a + b, 0)).toBe(N);
  });

  it("端数のあるサイズでも合計は total を保つ（剰余を取りこぼさない）", () => {
    for (const total of [3, 7, 16, 33, 99, 251]) {
      const c = counts(allocateRarities(total));
      expect([...c.values()].reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("ダミープール 16 枚の配分（★1×8 ★2×5 ★3×2 ★4×1 ★5×0）", () => {
    const c = counts(allocateRarities(16));
    expect(c.get(1)).toBe(8);
    expect(c.get(2)).toBe(5);
    expect(c.get(3)).toBe(2);
    expect(c.get(4)).toBe(1);
    expect(c.get(5)).toBe(0);
  });

  it("★5 はかなりレア（十分大きいプールで ★1 よりはるかに少ない）", () => {
    const c = counts(allocateRarities(10000));
    expect(c.get(5)!).toBeLessThan(c.get(1)!);
  });
});

describe("src と tools/rarity.mjs のロジック同一性（drift 検出）", () => {
  it("両 allocateRarities が全サイズで同一の配分を返す", async () => {
    // @ts-expect-error 型宣言のない .mjs を実行時に import
    const tools = await import("../tools/rarity.mjs");
    for (const total of [0, 1, 7, 16, 33, 100, 251, 10000]) {
      expect(tools.allocateRarities(total)).toEqual(allocateRarities(total));
    }
  });

  it("RARITY_DISTRIBUTION が src と tools で一致", async () => {
    // @ts-expect-error 型宣言のない .mjs を実行時に import
    const tools = await import("../tools/rarity.mjs");
    expect(tools.RARITY_DISTRIBUTION).toEqual(RARITY_DISTRIBUTION);
  });
});
