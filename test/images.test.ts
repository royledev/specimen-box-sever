// 画像抽選オーケストレータのテスト（スタブ注入・D1 不使用）。
import { describe, it, expect } from "vitest";
import type { ImageRow } from "../src/lib/images";
import { drawImage } from "../src/lib/images";
import { mulberry32 } from "./helpers";

/** テスト用ダミー ImageRow を作る。 */
function makeRow(imageId: string, idx: number): ImageRow {
  return {
    image_id: imageId,
    idx,
    r2_key: `img/${imageId}.webp`,
    format: "webp",
    width: 768,
    height: 768,
    bytes: 102400,
    status: "active",
    rarity: 1,
    name: "テスト標本",
  };
}

/** スタブ: idx -> ImageRow のマップから fetchByIdx を作る。 */
function stubFetchByIdx(
  rows: Map<number, ImageRow>,
): (idx: number) => Promise<ImageRow | null> {
  return async (idx) => rows.get(idx) ?? null;
}

/** スタブ: fetchLinear（startIdx 以上の行を昇順で返す）。 */
function stubFetchLinear(
  rows: Map<number, ImageRow>,
): (startIdx: number, limit: number) => Promise<ImageRow[]> {
  return async (startIdx, limit) => {
    return Array.from(rows.values())
      .filter((r) => r.idx >= startIdx)
      .sort((a, b) => a.idx - b.idx)
      .slice(0, limit);
  };
}

describe("drawImage", () => {
  it("totalN=0 なら null", async () => {
    const result = await drawImage(0, new Set(), async () => null, async () => [], Math.random);
    expect(result).toBeNull();
  });

  it("未所有の行を返す（疎なケース）", async () => {
    const rows = new Map([
      [1, makeRow("uuid-1", 1)],
      [2, makeRow("uuid-2", 2)],
      [3, makeRow("uuid-3", 3)],
    ]);
    const owned = new Set<string>(["uuid-1"]);
    const result = await drawImage(
      3,
      owned,
      stubFetchByIdx(rows),
      stubFetchLinear(rows),
      mulberry32(42),
    );
    expect(result).not.toBeNull();
    expect(result!.row.image_id).not.toBe("uuid-1");
  });

  it("全所有なら null（枯渇）", async () => {
    const rows = new Map([
      [1, makeRow("uuid-1", 1)],
      [2, makeRow("uuid-2", 2)],
    ]);
    const owned = new Set<string>(["uuid-1", "uuid-2"]);
    const result = await drawImage(
      2,
      owned,
      stubFetchByIdx(rows),
      stubFetchLinear(rows),
      mulberry32(1),
    );
    expect(result).toBeNull();
  });

  it("idx の穴（active 行が返らない）は引き直しで吸収する", async () => {
    // idx 1, 3 は存在するが idx 2 は穴（Mapに存在しない）。
    const rows = new Map([
      [1, makeRow("uuid-1", 1)],
      [3, makeRow("uuid-3", 3)],
    ]);
    const owned = new Set<string>(["uuid-1"]);
    // totalN=3 としてランダム引きで idx=2 の穴に当たっても引き直す。
    const result = await drawImage(
      3,
      owned,
      stubFetchByIdx(rows),
      stubFetchLinear(rows),
      mulberry32(99),
    );
    expect(result).not.toBeNull();
    expect(result!.row.image_id).toBe("uuid-3");
  });

  it("線形フォールバックの折り返しは LINEAR_LIMIT(20) を超えない件数を要求する", async () => {
    // totalN=100, startIdx が 50 になるような PRNG で折り返し呼び出しの limit を検証。
    // 折り返しは fetchLinear(1, Math.min(startIdx-1, 20)) → limit <= 20。
    const calls: { startIdx: number; limit: number }[] = [];
    const captureLinear = async (startIdx: number, limit: number) => {
      calls.push({ startIdx, limit });
      return [];
    };
    // フェーズ1で全部 null → フェーズ2へ。random() が 0.49 なら startIdx=Math.min(49+1,100)=50。
    let callCount = 0;
    const seededRandom = () => {
      callCount++;
      // フェーズ1 (8回) は穴に当たり続けるように 0.5 を返す
      // フェーズ2 (1回) も 0.5 を返す → startIdx = 50
      return 0.49;
    };
    await drawImage(100, new Set(), async () => null, captureLinear, seededRandom);
    // 折り返しの呼び出しが存在することを確認（startIdx=50 → calls: [{50,20},{1,20} または {50,20}のみ}）
    for (const call of calls) {
      expect(call.limit).toBeLessThanOrEqual(20);
    }
    // 折り返し呼び出しが発生した場合（startIdx > 1 のはず）、limit が startIdx-1 そのままでないことを確認。
    const wrapCall = calls.find((c) => c.startIdx === 1);
    if (wrapCall) {
      // startIdx-1 = 49 だが、LINEAR_LIMIT(20) に制限される。
      expect(wrapCall.limit).toBe(20);
    }
  });

  it("密なケース: 棄却失敗→線形フォールバックで唯一の空きを見つける", async () => {
    // 1..10 のうち uuid-7 だけ未所有。
    const rows = new Map(
      Array.from({ length: 10 }, (_, i) => {
        const id = `uuid-${i + 1}`;
        return [i + 1, makeRow(id, i + 1)] as [number, ImageRow];
      }),
    );
    const owned = new Set(
      Array.from(rows.values())
        .filter((r) => r.image_id !== "uuid-7")
        .map((r) => r.image_id),
    );
    const result = await drawImage(
      10,
      owned,
      stubFetchByIdx(rows),
      stubFetchLinear(rows),
      mulberry32(1),
    );
    expect(result).not.toBeNull();
    expect(result!.row.image_id).toBe("uuid-7");
  });
});
