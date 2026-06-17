// 標本レア度（★1〜★5）の割り当て（ADR-0009、旧 ADR-0008 を Supersede）。
// レア度は各標本(image)の不変・固有プロパティ。抽選は一様ランダム（ADR-0004 不変）のため、
// プール構成比 = 排出率になる。
//
// ADR-0009 転換点: レア度は「見た目」に反映されるため、生成より前に確定していなければならない。
// 旧 ADR-0008 の image_id ハッシュによる事後割り当て（assignRarity / FNV-1a）は廃止し、
// 生成パイプラインが下記構成比を「クォータ」として各バッチへ明示配分する（allocateRarities）。
// 配分結果（rarity）はマニフェストに記録され、seed/import がそれを信頼して D1 へ投入する。

export type Rarity = 1 | 2 | 3 | 4 | 5;

/** プール構成比（= 排出率）。合計 1.0。★5 はかなりレア。 */
export const RARITY_DISTRIBUTION: ReadonlyArray<{ rarity: Rarity; weight: number }> = [
  { rarity: 1, weight: 0.5 },
  { rarity: 2, weight: 0.3 },
  { rarity: 3, weight: 0.14 },
  { rarity: 4, weight: 0.05 },
  { rarity: 5, weight: 0.01 },
];

/**
 * total 枚のプールへレア度を「クォータ配分」する（ADR-0009 決定2・3）。
 * 各レア度の枚数 = total × weight を最大剰余法（largest remainder）で整数化し、
 * 構成比に最も近い配分を決定論的に返す（乱数不使用）。
 *
 * 返り値はレア度昇順（★1 から）に並べた配列で length === total。
 * 生成パイプラインは idx 順などでこの配列を消費し、各 image の rarity を確定する。
 *
 * 注: total が小さいと低割合レア度は 0 枚になりうる（例: total=16 では ★5=0）。
 * 実プール（数千〜数万）では構成比に厳密に一致する。
 */
export function allocateRarities(total: number): Rarity[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`allocateRarities: total は 0 以上の整数が必要 (got ${total})`);
  }

  // 各レア度の理想枚数 → floor と剰余に分解。
  const tiers = RARITY_DISTRIBUTION.map((t) => {
    const exact = total * t.weight;
    const count = Math.floor(exact);
    return { rarity: t.rarity, count, remainder: exact - count };
  });

  // floor 合計と total の差を、剰余の大きい順（同値はレア度昇順）に +1 して埋める。
  const assigned = tiers.reduce((a, t) => a + t.count, 0);
  const leftover = total - assigned;
  const byRemainder = [...tiers].sort(
    (a, b) => b.remainder - a.remainder || a.rarity - b.rarity,
  );
  for (let i = 0; i < leftover; i++) {
    byRemainder[i % byRemainder.length]!.count++;
  }

  // レア度昇順に展開（★1 を先頭に）。
  const out: Rarity[] = [];
  for (const t of tiers) {
    for (let i = 0; i < t.count; i++) out.push(t.rarity);
  }
  return out;
}
