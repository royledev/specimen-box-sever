// 画像抽選オーケストレータ（純粋関数 / ADR-0003・ADR-0004）。
// I/O（D1アクセス）と分離。fetch 関数をパラメータとして受け取るため、テスト時はスタブを注入できる。

import type { ImageRow } from "./db/imagesRepo";

export type { ImageRow };

/** image_id ＝ UUID。owned 集合の照合キー。 */
export type OwnedSet = Set<string>;

/**
 * D1からidxを指定して1行取得する関数型。
 * active 行が無いか idx の穴なら null を返す。
 */
export type FetchByIdx = (idx: number) => Promise<ImageRow | null>;

/**
 * idx >= startIdx の active 行を最大 limit 件返す関数型（線形フォールバック用）。
 */
export type FetchLinear = (startIdx: number, limit: number) => Promise<ImageRow[]>;

/** 最大棄却試行回数（棄却サンプリングフェーズ）。 */
const MAX_REJECT_TRIES = 8;

/** 線形フォールバックで取得する最大件数（密なケース対応）。 */
const LINEAR_LIMIT = 20;

export interface DrawImageResult {
  row: ImageRow;
}

/**
 * 未所有の active 画像を1件抽選する。
 * 1) ランダム idx 引き（棄却サンプリング）: owned に当たればスキップ。
 * 2) active でない idx（穴）は引き直しで吸収。
 * 3) 棄却失敗（密なケース）: ランダム開始点から線形走査フォールバック。
 * 4) すべて exhausted なら null。
 *
 * @param totalN    active 画像件数キャッシュ（≒ idx の最大値。穴があっても近似値で動作する）
 * @param owned     端末が供給する所有済み image_id の集合
 * @param fetchByIdx  idx 指定で D1 から1行取得（active のみ）
 * @param fetchLinear idx >= start の D1 行を最大 K 件取得（active のみ）
 * @param random    0..1 を返す乱数源（テスト時は決定論 PRNG を注入）
 */
export async function drawImage(
  totalN: number,
  owned: OwnedSet,
  fetchByIdx: FetchByIdx,
  fetchLinear: FetchLinear,
  random: () => number,
): Promise<DrawImageResult | null> {
  if (totalN <= 0) return null;

  // --- フェーズ1: 棄却サンプリング ---
  for (let i = 0; i < MAX_REJECT_TRIES; i++) {
    // random() は [0,1) を仮定。Math.min でクランプし totalN+1 への溢れを防ぐ。
    const idx = Math.min(Math.floor(random() * totalN) + 1, totalN);
    const row = await fetchByIdx(idx);
    if (!row) continue; // idx の穴（inactive or 存在しない）→ 引き直し
    if (!owned.has(row.image_id)) return { row };
    // owned に当たった → 引き直し
  }

  // --- フェーズ2: 線形フォールバック（密なケース）---
  // random() は [0,1) を仮定。Math.min でクランプ。
  const startIdx = Math.min(Math.floor(random() * totalN) + 1, totalN);
  // startIdx から N まで検索
  const upper = await fetchLinear(startIdx, LINEAR_LIMIT);
  for (const row of upper) {
    if (!owned.has(row.image_id)) return { row };
  }
  // 折り返し: 1 から startIdx-1 まで検索。一度のフォールバックで LINEAR_LIMIT を超えないよう制限。
  if (startIdx > 1) {
    const lower = await fetchLinear(1, Math.min(startIdx - 1, LINEAR_LIMIT));
    for (const row of lower) {
      if (!owned.has(row.image_id)) return { row };
    }
  }

  return null; // 枯渇
}
