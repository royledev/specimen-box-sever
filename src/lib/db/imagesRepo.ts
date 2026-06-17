// D1 images テーブルへのアクセス層（ADR-0003）。
// 純粋ロジックとI/Oを分離するため、純粋関数はこのファイルに依存しない。

import { D1Error } from "./errors";

export interface ImageRow {
  image_id: string;
  idx: number;
  r2_key: string;
  format: string;
  width: number;
  height: number;
  bytes: number | null;
  status: string;
  /** レア度（1=★1 〜 5=★5）。見た目に反映され、生成時に確定する（ADR-0009）。 */
  rarity: number;
  /** 表示名（日本語・例「怒った扇風機」）。生成時に確定する（ADR-0010）。 */
  name: string;
}

/** active 画像の総件数（ランダム idx 引きの上限 N）。 */
export async function countImages(db: D1Database): Promise<number> {
  try {
    const result = await db
      .prepare("SELECT COUNT(*) as n FROM images WHERE status = 'active'")
      .first<{ n: number }>();
    return result?.n ?? 0;
  } catch (e) {
    throw new D1Error("D1 countImages failed", { cause: e });
  }
}

/** idx = r の1行を取得（active のみ）。 */
export async function fetchImageByIdx(
  db: D1Database,
  idx: number,
): Promise<ImageRow | null> {
  try {
    const row = await db
      .prepare("SELECT * FROM images WHERE idx = ?1 AND status = 'active'")
      .bind(idx)
      .first<ImageRow>();
    return row ?? null;
  } catch (e) {
    throw new D1Error("D1 fetchImageByIdx failed", { cause: e });
  }
}

/**
 * idx >= startIdx の active 行を最大 limit 件取得（線形フォールバック用）。
 * 1件も無ければ空配列。
 */
export async function fetchImagesLinear(
  db: D1Database,
  startIdx: number,
  limit: number,
): Promise<ImageRow[]> {
  try {
    const result = await db
      .prepare(
        "SELECT * FROM images WHERE idx >= ?1 AND status = 'active' ORDER BY idx LIMIT ?2",
      )
      .bind(startIdx, limit)
      .all<ImageRow>();
    return result.results ?? [];
  } catch (e) {
    throw new D1Error("D1 fetchImagesLinear failed", { cause: e });
  }
}
