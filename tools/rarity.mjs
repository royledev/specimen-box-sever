// 標本レア度のクォータ配分（ADR-0009、旧 ADR-0008 を Supersede）。
// src/lib/rarity.ts の移植（.mjs ツールから使う）。両者は同一ロジックでなければならない。
// drift は test/seedIntegrity.test.ts（seed の rarity がマニフェストと一致するか）で検出する。

export const RARITY_DISTRIBUTION = [
  { rarity: 1, weight: 0.5 },
  { rarity: 2, weight: 0.3 },
  { rarity: 3, weight: 0.14 },
  { rarity: 4, weight: 0.05 },
  { rarity: 5, weight: 0.01 },
];

/**
 * total 枚のプールへレア度を最大剰余法でクォータ配分する（src/lib/rarity.ts と同一ロジック）。
 * 返り値はレア度昇順の配列で length === total。乱数不使用・決定論。
 */
export function allocateRarities(total) {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`allocateRarities: total は 0 以上の整数が必要 (got ${total})`);
  }

  const tiers = RARITY_DISTRIBUTION.map((t) => {
    const exact = total * t.weight;
    const count = Math.floor(exact);
    return { rarity: t.rarity, count, remainder: exact - count };
  });

  const assigned = tiers.reduce((a, t) => a + t.count, 0);
  const leftover = total - assigned;
  const byRemainder = [...tiers].sort(
    (a, b) => b.remainder - a.remainder || a.rarity - b.rarity,
  );
  for (let i = 0; i < leftover; i++) {
    byRemainder[i % byRemainder.length].count++;
  }

  const out = [];
  for (const t of tiers) {
    for (let i = 0; i < t.count; i++) out.push(t.rarity);
  }
  return out;
}
